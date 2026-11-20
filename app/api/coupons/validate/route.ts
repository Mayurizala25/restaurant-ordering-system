const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "Send the coupon code as JSON." }, { status: 415, headers: noStoreHeaders });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The coupon request is invalid." }, { status: 400, headers: noStoreHeaders });
  }
  if (
    !isRecord(body) ||
    typeof body.code !== "string" ||
    typeof body.subtotal !== "number" ||
    !Number.isFinite(body.subtotal) ||
    body.subtotal < 0
  ) {
    return Response.json({ error: "Enter a coupon code and valid subtotal." }, { status: 400, headers: noStoreHeaders });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (!supabaseUrl || !serviceRoleKey || !restaurantId || !UUID_PATTERN.test(restaurantId)) {
    return Response.json({ error: "Coupon validation is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  let rpcUrl: URL;
  try {
    rpcUrl = new URL("/rest/v1/rpc/validate_restaurant_coupon", supabaseUrl);
  } catch {
    return Response.json({ error: "Coupon validation is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        p_restaurant_id: restaurantId,
        p_code: body.code.trim(),
        p_subtotal: Math.round(body.subtotal * 100) / 100,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json({ error: "Coupon validation timed out. Try again." }, { status: 502, headers: noStoreHeaders });
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message.replace(/[\r\n\t]+/g, " ").trim().replace(/^P0001:\s*/, "")
        : "Coupon could not be applied.";
    return Response.json({ error: message }, { status: 422, headers: noStoreHeaders });
  }
  if (
    !isRecord(payload) ||
    typeof payload.coupon_code !== "string" ||
    typeof payload.discount_amount !== "number" ||
    !Number.isFinite(payload.discount_amount) ||
    payload.discount_amount < 0
  ) {
    return Response.json({ error: "Coupon response could not be verified." }, { status: 502, headers: noStoreHeaders });
  }

  return Response.json({
    couponCode: payload.coupon_code,
    discountAmount: payload.discount_amount,
  }, { headers: noStoreHeaders });
}
