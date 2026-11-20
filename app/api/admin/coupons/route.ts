import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getConfiguration() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (!supabaseUrl || !serviceRoleKey || !restaurantId || !UUID_PATTERN.test(restaurantId)) return null;
  try {
    const url = new URL("/rest/v1/restaurant_coupons", supabaseUrl);
    return { url, serviceRoleKey, restaurantId };
  } catch {
    return null;
  }
}

async function authorized(request: Request) {
  const cookieStore = await cookies();
  if (!(await verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value))) {
    return Response.json({ error: "Admin authentication is required." }, { status: 401, headers: noStoreHeaders });
  }
  if (request.method === "GET") return null;
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim();
  const protocol = forwarded ? `${forwarded}:` : url.protocol;
  if (origin !== new URL(`${protocol}//${host}`).origin) {
    return Response.json({ error: "Cross-origin coupon changes are not allowed." }, { status: 403, headers: noStoreHeaders });
  }
  return null;
}

export async function GET(request: Request) {
  const authError = await authorized(request);
  if (authError) return authError;
  const configuration = getConfiguration();
  if (!configuration) return Response.json({ error: "Coupons are not configured." }, { status: 503, headers: noStoreHeaders });
  const url = new URL(configuration.url);
  url.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  url.searchParams.set("select", "id,code,name,discount_type,discount_value,expiry_date,minimum_order_value,usage_limit,used_count,is_active,created_at");
  url.searchParams.set("order", "created_at.desc");
  const response = await fetch(url, { cache: "no-store", headers: { apikey: configuration.serviceRoleKey, Authorization: `Bearer ${configuration.serviceRoleKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return Response.json({ error: "Could not load coupons." }, { status: 502, headers: noStoreHeaders });
  const coupons: unknown = await response.json().catch(() => null);
  if (!Array.isArray(coupons)) return Response.json({ error: "Coupon data could not be read." }, { status: 502, headers: noStoreHeaders });
  return Response.json({ coupons }, { headers: noStoreHeaders });
}

function parseCoupon(body: unknown) {
  if (!isRecord(body)) return null;
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const discountType = body.discountType;
  const discountValue = typeof body.discountValue === "number" ? body.discountValue : NaN;
  const expiryDate = body.expiryDate === null || body.expiryDate === "" ? null : body.expiryDate;
  const minimumOrderValue = typeof body.minimumOrderValue === "number" ? body.minimumOrderValue : NaN;
  const usageLimit =
    body.usageLimit === null || body.usageLimit === ""
      ? null
      : typeof body.usageLimit === "number"
        ? body.usageLimit
        : typeof body.usageLimit === "string" && body.usageLimit.trim() !== ""
          ? Number(body.usageLimit)
          : undefined;

  if (
    !CODE_PATTERN.test(code) ||
    (discountType !== "percentage" && discountType !== "fixed") ||
    !Number.isFinite(discountValue) ||
    discountValue < 0 ||
    (discountType === "percentage" && discountValue > 100) ||
    !Number.isFinite(minimumOrderValue) ||
    minimumOrderValue < 0 ||
    usageLimit === undefined ||
    (usageLimit !== null &&
      usageLimit !== undefined &&
      (!Number.isSafeInteger(usageLimit) || usageLimit < 1)) ||
    (expiryDate !== null && (typeof expiryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)))
  ) return null;

  return {
    code,
    name,
    discount_type: discountType,
    discount_value: discountValue,
    expiry_date: expiryDate,
    minimum_order_value: minimumOrderValue,
    usage_limit: usageLimit,
  };
}

export async function POST(request: Request) {
  const authError = await authorized(request);
  if (authError) return authError;
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Send the coupon as JSON." }, { status: 415, headers: noStoreHeaders });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid coupon JSON." }, { status: 400, headers: noStoreHeaders }); }
  const parsed = parseCoupon(body);
  if (!parsed) return Response.json({ error: "Enter valid coupon fields." }, { status: 400, headers: noStoreHeaders });
  const configuration = getConfiguration();
  if (!configuration) return Response.json({ error: "Coupons are not configured." }, { status: 503, headers: noStoreHeaders });
  const url = new URL(configuration.url);
  url.searchParams.set("select", "id,code,name,discount_type,discount_value,expiry_date,minimum_order_value,usage_limit,used_count,is_active");
  const response = await fetch(url, {
    method: "POST", cache: "no-store",
    headers: { apikey: configuration.serviceRoleKey, Authorization: `Bearer ${configuration.serviceRoleKey}`, "Content-Type": "application/json", Accept: "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ ...parsed, restaurant_id: configuration.restaurantId, is_active: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const duplicate = isRecord(payload) && payload.code === "23505";
    return Response.json({ error: duplicate ? "A coupon with this code already exists." : "Could not create coupon." }, { status: duplicate ? 409 : 502, headers: noStoreHeaders });
  }
  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1) return Response.json({ error: "Coupon could not be confirmed." }, { status: 502, headers: noStoreHeaders });
  return Response.json({ coupon: rows[0] }, { status: 201, headers: noStoreHeaders });
}

export async function PATCH(request: Request) {
  const authError = await authorized(request);
  if (authError) return authError;
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Send the coupon as JSON." }, { status: 415, headers: noStoreHeaders });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid coupon JSON." }, { status: 400, headers: noStoreHeaders }); }
  if (!isRecord(body) || typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return Response.json({ error: "Invalid coupon." }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseCoupon(body);
  if (!parsed) return Response.json({ error: "Enter valid coupon fields." }, { status: 400, headers: noStoreHeaders });
  const configuration = getConfiguration();
  if (!configuration) return Response.json({ error: "Coupons are not configured." }, { status: 503, headers: noStoreHeaders });
  const update: Record<string, unknown> = { ...parsed };
  if (typeof body.isActive === "boolean") update.is_active = body.isActive;
  const url = new URL(configuration.url);
  url.searchParams.set("id", `eq.${body.id}`);
  url.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  url.searchParams.set("select", "id,code,name,discount_type,discount_value,expiry_date,minimum_order_value,usage_limit,used_count,is_active");
  const response = await fetch(url, {
    method: "PATCH", cache: "no-store",
    headers: { apikey: configuration.serviceRoleKey, Authorization: `Bearer ${configuration.serviceRoleKey}`, "Content-Type": "application/json", Accept: "application/json", Prefer: "return=representation" },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return Response.json({ error: "Could not update coupon." }, { status: 502, headers: noStoreHeaders });
  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1) return Response.json({ error: "Coupon could not be confirmed." }, { status: 502, headers: noStoreHeaders });
  return Response.json({ coupon: rows[0] }, { headers: noStoreHeaders });
}
