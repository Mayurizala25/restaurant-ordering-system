import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../lib/admin-session";

const MAX_BODY_BYTES = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/;
const UPDATABLE_ORDER_STATUSES = [
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;

type OrderLineInput = {
  itemId: string;
  quantity: number;
};

type OrderInput = {
  customerName: string;
  customerPhone: string;
  tableNumber: number;
  requestId: string;
  items: OrderLineInput[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOrderInput(value: unknown): OrderInput | null {
  if (!isRecord(value)) return null;

  const { customerName, customerPhone, tableNumber, requestId, items } = value;
  if (
    typeof customerName !== "string" ||
    customerName.trim().length < 1 ||
    customerName.trim().length > 100 ||
    typeof customerPhone !== "string" ||
    customerPhone.length > 20 ||
    !PHONE_PATTERN.test(customerPhone.trim()) ||
    customerPhone.replace(/\D/g, "").length < 7 ||
    customerPhone.replace(/\D/g, "").length > 15 ||
    typeof tableNumber !== "number" ||
    !Number.isSafeInteger(tableNumber) ||
    tableNumber < 1 ||
    typeof requestId !== "string" ||
    !UUID_PATTERN.test(requestId) ||
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 50
  ) {
    return null;
  }

  const parsedItems: OrderLineInput[] = [];
  const itemIds = new Set<string>();
  for (const item of items) {
    if (
      !isRecord(item) ||
      typeof item.itemId !== "string" ||
      item.itemId.trim().length < 1 ||
      item.itemId.length > 128 ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99 ||
      itemIds.has(item.itemId)
    ) {
      return null;
    }

    const itemId = item.itemId.trim();
    if (itemIds.has(itemId)) return null;
    itemIds.add(itemId);
    parsedItems.push({
      itemId,
      quantity: item.quantity,
    });
  }

  return {
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    tableNumber,
    requestId,
    items: parsedItems,
  };
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  let validSession: boolean;
  try {
    validSession = await verifyAdminSessionToken(sessionToken);
  } catch {
    return Response.json(
      { error: "Admin session verification is temporarily unavailable. Try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!validSession) {
    return Response.json(
      { error: "Admin authentication is required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return Response.json(
      { error: "Order data is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let ordersUrl: URL;
  try {
    ordersUrl = new URL("/rest/v1/restaurant_orders", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      ordersUrl.hostname,
    );
    if (
      (ordersUrl.protocol !== "https:" &&
        !(ordersUrl.protocol === "http:" && isLoopback)) ||
      ordersUrl.username ||
      ordersUrl.password
    ) {
      return Response.json(
        { error: "Order data is not configured securely." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return Response.json(
      { error: "Order data is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  ordersUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  ordersUrl.searchParams.set(
    "select",
    "id,status,total_inr,created_at,restaurant_tables(table_number),restaurant_order_items(id,item_name,unit_price_inr,quantity,line_total_inr)",
  );
  ordersUrl.searchParams.set("order", "created_at.desc");

  let response: Response;
  const timeoutSignal = AbortSignal.timeout(10_000);
  try {
    response = await fetch(ordersUrl, {
      method: "GET",
      cache: "no-store",
      signal: timeoutSignal,
      headers: {
        apikey: supabaseServiceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return Response.json(
      {
        error: timeoutSignal.aborted
          ? "Loading orders timed out. Try again."
          : "Could not load orders.",
      },
      {
        status: timeoutSignal.aborted ? 504 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Could not load orders." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  let orders: unknown;
  try {
    orders = await response.json();
  } catch {
    return Response.json(
      {
        error: timeoutSignal.aborted
          ? "Loading orders timed out. Try again."
          : "Order data could not be read.",
      },
      {
        status: timeoutSignal.aborted ? 504 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (!Array.isArray(orders)) {
    return Response.json(
      { error: "Order data could not be read." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { orders, restaurantId },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSessionToken(sessionToken))) {
    return Response.json(
      { error: "Admin authentication is required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestUrl = new URL(request.url);
  const requestHost = request.headers.get("host") ?? requestUrl.host;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim();
  const requestProtocol = forwardedProtocol
    ? `${forwardedProtocol}:`
    : requestUrl.protocol;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(`${requestProtocol}//${requestHost}`).origin;
  } catch {
    return Response.json(
      { error: "Order update origin could not be verified." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (request.headers.get("origin") !== expectedOrigin) {
    return Response.json(
      { error: "Cross-origin order updates are not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return Response.json(
      { error: "Send the order update as JSON." },
      { status: 415, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "The order update is not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (
    !isRecord(body) ||
    typeof body.orderId !== "string" ||
    !UUID_PATTERN.test(body.orderId) ||
    typeof body.status !== "string" ||
    !UPDATABLE_ORDER_STATUSES.includes(
      body.status as (typeof UPDATABLE_ORDER_STATUSES)[number],
    )
  ) {
    return Response.json(
      { error: "Choose a valid order and status." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return Response.json(
      { error: "Order updates are not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let updateUrl: URL;
  try {
    updateUrl = new URL("/rest/v1/restaurant_orders", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      updateUrl.hostname,
    );
    if (
      (updateUrl.protocol !== "https:" &&
        !(updateUrl.protocol === "http:" && isLoopback)) ||
      updateUrl.username ||
      updateUrl.password
    ) {
      return Response.json(
        { error: "Order updates are not configured securely." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return Response.json(
      { error: "Order updates are not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  updateUrl.searchParams.set("id", `eq.${body.orderId}`);
  updateUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  updateUrl.searchParams.set("select", "id,status");

  let response: Response;
  try {
    response = await fetch(updateUrl, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: supabaseServiceRoleKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status: body.status }),
    });
  } catch {
    return Response.json(
      { error: "Could not update the order status." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Could not update the order status." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  let updatedRows: unknown;
  try {
    updatedRows = await response.json();
  } catch {
    updatedRows = null;
  }
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    return Response.json(
      { error: "Order not found for this restaurant." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const updatedOrder = updatedRows[0];
  if (
    !isRecord(updatedOrder) ||
    updatedOrder.id !== body.orderId ||
    updatedOrder.status !== body.status
  ) {
    return Response.json(
      { error: "Order status could not be confirmed." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { order: { id: updatedOrder.id, status: updatedOrder.status } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const requestHost = request.headers.get("host") ?? requestUrl.host;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim();
  const requestProtocol = forwardedProtocol
    ? `${forwardedProtocol}:`
    : requestUrl.protocol;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(`${requestProtocol}//${requestHost}`).origin;
  } catch {
    return Response.json({ error: "Order submission origin could not be verified." }, { status: 403 });
  }

  let normalizedOrigin: string;
  try {
    const parsedOrigin = new URL(origin ?? "");
    if (
      !["http:", "https:"].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== origin
    ) {
      throw new Error("Invalid origin.");
    }
    normalizedOrigin = parsedOrigin.origin;
  } catch {
    return Response.json({ error: "Order submission origin could not be verified." }, { status: 403 });
  }

  if (normalizedOrigin !== expectedOrigin) {
    return Response.json({ error: "Cross-origin order submission is not allowed." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "Send the order as JSON." }, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "The order is too large." }, { status: 413 });
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return Response.json({ error: "The order request is empty." }, { status: 400 });
  }

  const bodyChunks: Uint8Array[] = [];
  let bodySize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bodySize += value.byteLength;
      if (bodySize > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: "The order is too large." }, { status: 413 });
      }
      bodyChunks.push(value);
    }
  } catch {
    return Response.json({ error: "The order request could not be read." }, { status: 400 });
  }

  const bodyBytes = new Uint8Array(bodySize);
  let bodyOffset = 0;
  for (const chunk of bodyChunks) {
    bodyBytes.set(chunk, bodyOffset);
    bodyOffset += chunk.byteLength;
  }
  const rawBody = new TextDecoder().decode(bodyBytes);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "The order request is not valid JSON." }, { status: 400 });
  }

  const order = validateOrderInput(body);
  if (!order) {
    return Response.json({ error: "Check the customer details, table, and order items." }, { status: 400 });
  }
  const trackingToken = randomBytes(32).toString("hex");
  const trackingTokenHash = createHash("sha256")
    .update(trackingToken)
    .digest("hex");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  const missingConfiguration = [
    !supabaseUrl && "SUPABASE_URL",
    !supabaseServiceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    !restaurantId && "SUPABASE_RESTAURANT_ID",
  ].filter((name): name is string => Boolean(name));
  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    console.error(
      "Order submission is unavailable. Missing or invalid Supabase settings:",
      missingConfiguration.length > 0
        ? missingConfiguration
        : ["SUPABASE_RESTAURANT_ID must be a UUID"],
    );
    return Response.json({ error: "Order submission is not configured." }, { status: 503 });
  }

  let rpcUrl: URL;
  try {
    rpcUrl = new URL("/rest/v1/rpc/place_restaurant_order", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(rpcUrl.hostname);
    if (
      (rpcUrl.protocol !== "https:" && !(rpcUrl.protocol === "http:" && isLoopback)) ||
      rpcUrl.username ||
      rpcUrl.password
    ) {
      return Response.json({ error: "Order submission is not configured securely." }, { status: 503 });
    }
  } catch {
    console.error("Order submission is unavailable: SUPABASE_URL is invalid.");
    return Response.json({ error: "Order submission is not configured." }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_restaurant_id: restaurantId,
        p_request_id: order.requestId,
        p_customer_name: order.customerName,
        p_customer_phone: order.customerPhone,
        p_table_number: order.tableNumber,
        p_items: order.items,
      }),
    });
  } catch (cause) {
    console.error(
      "Supabase order request failed.",
      cause instanceof Error ? cause.message : "Unknown network error.",
    );
    return Response.json(
      { error: "We could not confirm the order. Please retry using the same cart." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    console.error("Supabase order RPC returned HTTP", response.status);
    const configurationError =
      response.status === 404 || response.status === 401 || response.status === 403;
    const temporaryError = response.status >= 500 || response.status === 429;
    return Response.json(
      {
        error:
          configurationError
            ? "Order submission is not configured correctly."
            : temporaryError
              ? "We could not confirm the order. Please retry using the same cart."
              : "A menu item or table is unavailable. Refresh the menu and try again.",
      },
      {
        status:
          configurationError
            ? 503
            : temporaryError
              ? 502
              : 422,
      },
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    console.error("Supabase order RPC returned invalid JSON.");
    return Response.json({ error: "We could not confirm the order. Please retry." }, { status: 502 });
  }

  if (
    !isRecord(result) ||
    typeof result.order_id !== "string" ||
    !UUID_PATTERN.test(result.order_id) ||
    !Number.isFinite(Number(result.total)) ||
    Number(result.total) < 0
  ) {
    console.error("Supabase order RPC returned an invalid order confirmation.");
    return Response.json({ error: "We could not confirm the order. Please retry." }, { status: 502 });
  }

  let trackingUrl: URL;
  try {
    trackingUrl = new URL("/rest/v1/restaurant_orders", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      trackingUrl.hostname,
    );
    if (
      (trackingUrl.protocol !== "https:" &&
        !(trackingUrl.protocol === "http:" && isLoopback)) ||
      trackingUrl.username ||
      trackingUrl.password
    ) {
      return Response.json(
        { error: "Order tracking is not configured securely." },
        { status: 503 },
      );
    }
  } catch {
    return Response.json({ error: "Order tracking is not configured." }, { status: 503 });
  }
  trackingUrl.searchParams.set("id", `eq.${result.order_id}`);
  trackingUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  trackingUrl.searchParams.set("request_id", `eq.${order.requestId}`);
  trackingUrl.searchParams.set("select", "id");

  let trackingResponse: Response;
  try {
    trackingResponse = await fetch(trackingUrl, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: supabaseServiceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        Accept: "application/json",
      },
      body: JSON.stringify({ tracking_token_hash: trackingTokenHash }),
    });
  } catch (cause) {
    console.error(
      "Order was saved, but its tracking-token hash could not be stored.",
      cause instanceof Error ? cause.message : "Unknown network error.",
    );
    return Response.json(
      {
        error:
          "Your order was saved, but its secure tracking link is unavailable. You can safely retry this same checkout; it will not create another order. If the problem continues, contact the restaurant.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!trackingResponse.ok) {
    const trackingError: unknown = await trackingResponse.json().catch(() => null);
    const errorCode =
      isRecord(trackingError) && typeof trackingError.code === "string"
        ? trackingError.code
        : null;
    const missingTrackingColumn =
      (errorCode === "42703" &&
        isRecord(trackingError) &&
        typeof trackingError.message === "string" &&
        trackingError.message.includes("tracking_token_hash")) ||
      (errorCode === "PGRST204" &&
        isRecord(trackingError) &&
        typeof trackingError.message === "string" &&
        trackingError.message.includes("tracking_token_hash"));
    if (missingTrackingColumn) {
      console.error(
        "Order tracking migration is not applied: restaurant_orders.tracking_token_hash is unavailable.",
      );
    } else {
      console.error(
        "Order was saved, but Supabase rejected its tracking-token hash update.",
        trackingResponse.status,
        errorCode ?? "unknown error",
      );
    }
    return Response.json(
      {
        error:
          "Your order was saved, but its secure tracking link is unavailable. You can safely retry this same checkout; it will not create another order. If the problem continues, contact the restaurant.",
      },
      {
        status: missingTrackingColumn ? 503 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  let trackingRows: unknown;
  try {
    trackingRows = await trackingResponse.json();
  } catch {
    return Response.json(
      {
        error:
          "Your order was saved, but its secure tracking link could not be confirmed. You can safely retry this same checkout; it will not create another order.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (
    !Array.isArray(trackingRows) ||
    trackingRows.length !== 1 ||
    !isRecord(trackingRows[0]) ||
    trackingRows[0].id !== result.order_id
  ) {
    console.error("Supabase did not confirm the stored tracking token for the order.");
    return Response.json(
      {
        error:
          "Your order was saved, but its secure tracking link could not be confirmed. You can safely retry this same checkout; it will not create another order.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      orderId: result.order_id,
      total: Number(result.total),
      trackingToken,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
