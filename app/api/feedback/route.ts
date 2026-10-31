import { createHash } from "node:crypto";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 16_384;

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
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      url.hostname,
    );
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
    return jsonError("Send feedback as JSON.", 415);
  }

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return jsonError("Feedback is too large.", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonError("Feedback is not valid JSON.", 400);
  }
  if (
    !isRecord(body) ||
    typeof body.token !== "string" ||
    !TOKEN_PATTERN.test(body.token) ||
    typeof body.rating !== "number" ||
    !Number.isSafeInteger(body.rating) ||
    body.rating < 1 ||
    body.rating > 5 ||
    typeof body.comment !== "string" ||
    body.comment.trim().length > 1000 ||
    body.comment.includes("\0")
  ) {
    return jsonError("Enter a rating from 1 to 5 and a comment of at most 1000 characters.", 400);
  }

  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Feedback storage is not configured.", 503);
  }

  const tokenHash = createHash("sha256").update(body.token).digest("hex");
  const orderUrl = new URL(configuration.url);
  orderUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  orderUrl.searchParams.set("tracking_token_hash", `eq.${tokenHash}`);
  orderUrl.searchParams.set("select", "id");
  orderUrl.searchParams.set("limit", "1");

  let orderResponse: Response;
  try {
    orderResponse = await fetch(orderUrl, {
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return jsonError("Could not verify this order.", 502);
  }
  if (!orderResponse.ok) return jsonError("Could not verify this order.", 502);

  let orders: unknown;
  try {
    orders = await orderResponse.json();
  } catch {
    return jsonError("Order verification data could not be read.", 502);
  }
  if (
    !Array.isArray(orders) ||
    orders.length !== 1 ||
    !isRecord(orders[0]) ||
    typeof orders[0].id !== "string" ||
    !UUID_PATTERN.test(orders[0].id)
  ) {
    return jsonError("This order is unavailable for feedback.", 404);
  }

  const feedbackUrl = new URL("/rest/v1/restaurant_feedback", configuration.url);
  feedbackUrl.searchParams.set("on_conflict", "restaurant_id,order_id");
  let feedbackResponse: Response;
  try {
    feedbackResponse = await fetch(feedbackUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        restaurant_id: configuration.restaurantId,
        order_id: orders[0].id,
        rating: body.rating,
        comment: body.comment.trim(),
      }),
    });
  } catch {
    return jsonError("Could not save your feedback.", 502);
  }
  if (!feedbackResponse.ok) {
    return jsonError("Could not save your feedback.", 502);
  }

  return Response.json({ saved: true }, { headers: noStoreHeaders });
}
