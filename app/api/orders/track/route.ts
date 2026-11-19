import { createHash } from "node:crypto";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const ORDER_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function getConfiguration() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return null;
  }
  try {
    const url = new URL("/rest/v1/restaurant_orders", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopback)) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return { url, serviceRoleKey, restaurantId };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return jsonError("Send the tracking token as JSON.", 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The tracking request is not valid JSON.", 400);
  }
  if (!isRecord(body) || typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) {
    return jsonError("This order tracking link is invalid or unavailable.", 404);
  }

  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Order tracking is not configured.", 503);
  }

  const tokenHash = createHash("sha256").update(body.token).digest("hex");
  const url = new URL(configuration.url);
  url.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  url.searchParams.set("tracking_token_hash", `eq.${tokenHash}`);
  url.searchParams.set(
    "select",
    "id,status,total_inr,created_at,customer_name,restaurant_tables(table_number),restaurant_order_items(id,item_name,unit_price_inr,quantity,line_total_inr)",
  );
  url.searchParams.set("limit", "1");

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return jsonError("Could not load this order's status.", 502);
  }
  if (!response.ok) return jsonError("Could not load this order's status.", 502);

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return jsonError("Order tracking data could not be read.", 502);
  }
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
    return jsonError("This order tracking link is invalid or unavailable.", 404);
  }

  const order = rows[0];
  if (
    typeof order.id !== "string" ||
    !UUID_PATTERN.test(order.id) ||
    typeof order.status !== "string" ||
    !ORDER_STATUSES.includes(order.status as (typeof ORDER_STATUSES)[number]) ||
    typeof order.created_at !== "string" ||
    !Number.isFinite(Date.parse(order.created_at)) ||
    typeof order.customer_name !== "string" ||
    (typeof order.total_inr !== "string" &&
      typeof order.total_inr !== "number") ||
    !Number.isFinite(Number(order.total_inr)) ||
    Number(order.total_inr) < 0 ||
    !isRecord(order.restaurant_tables) ||
    typeof order.restaurant_tables.table_number !== "number" ||
    !Number.isSafeInteger(order.restaurant_tables.table_number) ||
    !Array.isArray(order.restaurant_order_items)
  ) {
    return jsonError("Order tracking data is invalid.", 502);
  }

  const items = [];
  for (const item of order.restaurant_order_items) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.item_name !== "string" ||
      (typeof item.unit_price_inr !== "string" &&
        typeof item.unit_price_inr !== "number") ||
      !Number.isFinite(Number(item.unit_price_inr)) ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      (typeof item.line_total_inr !== "string" &&
        typeof item.line_total_inr !== "number") ||
      !Number.isFinite(Number(item.line_total_inr))
    ) {
      return jsonError("Order tracking item data is invalid.", 502);
    }
    items.push({
      name: item.item_name,
      unitPrice: Number(item.unit_price_inr),
      quantity: item.quantity,
      lineTotal: Number(item.line_total_inr),
    });
  }

  return Response.json(
    {
      order: {
        orderNumber: order.id,
        status: order.status,
        createdAt: order.created_at,
        customerName: order.customer_name,
        total: Number(order.total_inr),
        tableNumber: order.restaurant_tables.table_number,
        items,
      },
    },
    { headers: noStoreHeaders },
  );
}
