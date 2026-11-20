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
    const url = new URL("/rest/v1/restaurant_restaurants", supabaseUrl);
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

async function authorize(request?: Request): Promise<Response | null> {
  const cookieStore = await cookies();
  let validSession: boolean;
  try {
    validSession = await verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    );
  } catch {
    return jsonError("Admin session verification is temporarily unavailable.", 503);
  }
  if (!validSession) return jsonError("Admin authentication is required.", 401);

  if (request) {
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host") ?? requestUrl.host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      .trim();
    const protocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
    try {
      const expectedOrigin = new URL(`${protocol}//${requestHost}`).origin;
      if (request.headers.get("origin") !== expectedOrigin) {
        return jsonError("Cross-origin tax setting changes are not allowed.", 403);
      }
    } catch {
      return jsonError("Tax setting change origin could not be verified.", 403);
    }
  }

  return null;
}

function createRestaurantUrl(
  configuration: NonNullable<ReturnType<typeof getConfiguration>>,
) {
  const url = new URL(configuration.url);
  url.searchParams.set("id", `eq.${configuration.restaurantId}`);
  url.searchParams.set("select", "id,tax_rate_percent");
  return url;
}

function parseTaxRate(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const rate = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  return Number.isFinite(rate) &&
    rate >= 0 &&
    rate <= 100 &&
    Number(rate.toFixed(2)) === rate
    ? rate
    : null;
}

async function parseResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function upstreamError(payload: unknown, status: number) {
  return isRecord(payload) && typeof payload.message === "string"
    ? payload.message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300)
    : `Supabase returned HTTP ${status}.`;
}

export async function GET() {
  const authorizationError = await authorize();
  if (authorizationError) return authorizationError;

  const configuration = getConfiguration();
  if (!configuration) return jsonError("Tax settings are not configured.", 503);

  let response: Response;
  try {
    response = await fetch(createRestaurantUrl(configuration), {
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Authorization: `Bearer ${configuration.serviceRoleKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return jsonError("Could not connect to tax settings in Supabase.", 502);
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message = upstreamError(payload, response.status);
    console.error("Could not load restaurant tax settings.", message);
    return jsonError(`Could not load tax settings: ${message}`, 502);
  }
  if (
    !Array.isArray(payload) ||
    payload.length !== 1 ||
    !isRecord(payload[0]) ||
    payload[0].id !== configuration.restaurantId
  ) {
    return jsonError("Restaurant tax settings could not be verified.", 502);
  }

  const taxRatePercent = parseTaxRate(payload[0].tax_rate_percent);
  if (taxRatePercent === null) {
    return jsonError("Restaurant tax rate is invalid.", 502);
  }

  return Response.json({ taxRatePercent }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request) {
  const authorizationError = await authorize(request);
  if (authorizationError) return authorizationError;

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return jsonError("Send the tax setting as JSON.", 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The tax setting is not valid JSON.", 400);
  }
  const taxRatePercent = isRecord(body)
    ? parseTaxRate(body.taxRatePercent)
    : null;
  if (taxRatePercent === null) {
    return jsonError(
      "Enter a tax rate from 0 to 100 with at most two decimal places.",
      400,
    );
  }

  const configuration = getConfiguration();
  if (!configuration) return jsonError("Tax settings are not configured.", 503);

  let response: Response;
  try {
    response = await fetch(createRestaurantUrl(configuration), {
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Authorization: `Bearer ${configuration.serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ tax_rate_percent: taxRatePercent }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return jsonError("Could not save tax settings to Supabase.", 502);
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message = upstreamError(payload, response.status);
    console.error("Could not save restaurant tax settings.", message);
    return jsonError(`Could not save tax settings: ${message}`, 502);
  }
  if (
    !Array.isArray(payload) ||
    payload.length !== 1 ||
    !isRecord(payload[0]) ||
    payload[0].id !== configuration.restaurantId
  ) {
    return jsonError("Tax rate could not be confirmed after saving.", 502);
  }

  const savedRate = parseTaxRate(payload[0].tax_rate_percent);
  if (savedRate !== taxRatePercent) {
    return jsonError("Tax rate could not be confirmed after saving.", 502);
  }

  return Response.json({ taxRatePercent: savedRate }, { headers: noStoreHeaders });
}
