import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function mapFeedback(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.order_id !== "string" ||
    !UUID_PATTERN.test(value.order_id) ||
    typeof value.rating !== "number" ||
    !Number.isSafeInteger(value.rating) ||
    value.rating < 1 ||
    value.rating > 5 ||
    typeof value.comment !== "string" ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at))
  ) {
    return null;
  }
  return {
    id: value.id,
    orderId: value.order_id,
    rating: value.rating,
    comment: value.comment,
    createdAt: value.created_at,
  };
}

export async function GET() {
  const cookieStore = await cookies();
  let validSession: boolean;
  try {
    validSession = await verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    );
  } catch {
    return jsonError(
      "Admin session verification is temporarily unavailable. Try again.",
      503,
    );
  }
  if (!validSession) {
    return jsonError("Admin authentication is required.", 401);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return jsonError("Feedback storage is not configured.", 503);
  }

  let url: URL;
  try {
    url = new URL("/rest/v1/restaurant_feedback", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopback)) ||
      url.username ||
      url.password
    ) {
      return jsonError("Feedback storage is not configured securely.", 503);
    }
  } catch {
    return jsonError("Feedback storage is not configured.", 503);
  }

  url.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  url.searchParams.set("select", "id,order_id,rating,comment,created_at");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "100");

  let response: Response;
  const timeoutSignal = AbortSignal.timeout(10_000);
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: timeoutSignal,
      headers: { apikey: serviceRoleKey, Accept: "application/json" },
    });
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Loading restaurant feedback timed out. Try again.", 504)
      : jsonError("Could not load restaurant feedback.", 502);
  }
  if (!response.ok) return jsonError("Could not load restaurant feedback.", 502);

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Loading restaurant feedback timed out. Try again.", 504)
      : jsonError("Feedback data could not be read.", 502);
  }
  if (!Array.isArray(rows)) {
    return jsonError("Feedback data is invalid.", 502);
  }
  const feedback = rows.map(mapFeedback);
  if (feedback.some((entry) => entry === null)) {
    return jsonError("Feedback data is invalid.", 502);
  }

  return Response.json(
    { feedback },
    { headers: noStoreHeaders },
  );
}
