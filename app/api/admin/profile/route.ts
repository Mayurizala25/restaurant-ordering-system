import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_COLUMNS =
  "id,name,logo_url,cover_image_url,address,phone,opening_hours,currency,google_review_url";
const MAX_BODY_BYTES = 16_384;

type Profile = {
  name: string;
  logoUrl: string;
  coverImageUrl: string;
  address: string;
  phone: string;
  openingHours: string;
  currency: string;
  googleReviewUrl: string;
};

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
  if (
    !(await verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    ))
  ) {
    return jsonError("Admin authentication is required.", 401);
  }

  if (request) {
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host") ?? requestUrl.host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      .trim();
    const requestProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
    try {
      const expectedOrigin = new URL(
        `${requestProtocol}//${requestHost}`,
      ).origin;
      if (request.headers.get("origin") !== expectedOrigin) {
        return jsonError("Cross-origin profile changes are not allowed.", 403);
      }
    } catch {
      return jsonError("Profile change origin could not be verified.", 403);
    }
  }
  return null;
}

function mapProfile(value: unknown): Profile | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    (typeof value.logo_url !== "string" && value.logo_url !== null) ||
    typeof value.cover_image_url !== "string" ||
    typeof value.address !== "string" ||
    typeof value.phone !== "string" ||
    typeof value.opening_hours !== "string" ||
    typeof value.currency !== "string" ||
    typeof value.google_review_url !== "string"
  ) {
    return null;
  }
  return {
    name: value.name,
    logoUrl: value.logo_url ?? "",
    coverImageUrl: value.cover_image_url,
    address: value.address,
    phone: value.phone,
    openingHours: value.opening_hours,
    currency: value.currency,
    googleReviewUrl: value.google_review_url,
  };
}

function validateProfile(value: unknown): Profile | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.logoUrl !== "string" ||
    typeof value.coverImageUrl !== "string" ||
    typeof value.address !== "string" ||
    typeof value.phone !== "string" ||
    typeof value.openingHours !== "string" ||
    typeof value.currency !== "string" ||
    typeof value.googleReviewUrl !== "string"
  ) {
    return null;
  }

  const profile: Profile = {
    name: value.name.trim(),
    logoUrl: value.logoUrl.trim(),
    coverImageUrl: value.coverImageUrl.trim(),
    address: value.address.trim(),
    phone: value.phone.trim(),
    openingHours: value.openingHours.trim(),
    currency: value.currency.trim().toUpperCase(),
    googleReviewUrl: value.googleReviewUrl.trim(),
  };
  if (
    profile.name.length < 1 ||
    profile.name.length > 120 ||
    profile.address.length < 1 ||
    profile.address.length > 250 ||
    !/^\+?[0-9][0-9 ()-]{5,28}[0-9]$/.test(profile.phone) ||
    profile.phone.replace(/\D/g, "").length < 7 ||
    profile.phone.replace(/\D/g, "").length > 15 ||
    profile.openingHours.length > 500 ||
    !/^[A-Z]{3}$/.test(profile.currency)
  ) {
    return null;
  }

  for (const url of [
    profile.logoUrl,
    profile.coverImageUrl,
    profile.googleReviewUrl,
  ]) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        url.length > 2048
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return profile;
}

function createProfileUrl(
  configuration: NonNullable<ReturnType<typeof getConfiguration>>,
) {
  const url = new URL(configuration.url);
  url.searchParams.set("id", `eq.${configuration.restaurantId}`);
  return url;
}

export async function GET() {
  const authorizationError = await authorize();
  if (authorizationError) return authorizationError;

  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Restaurant profile storage is not configured.", 503);
  }
  const url = createProfileUrl(configuration);
  url.searchParams.set("select", PROFILE_COLUMNS);

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
    return jsonError("Could not load the restaurant profile.", 502);
  }
  if (!response.ok) {
    return jsonError("Could not load the restaurant profile.", 502);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return jsonError("Restaurant profile data could not be read.", 502);
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    return jsonError("The configured restaurant was not found.", 404);
  }
  const profile = mapProfile(rows[0]);
  if (!profile) {
    return jsonError("Restaurant profile data is invalid.", 502);
  }
  return Response.json({ profile }, { headers: noStoreHeaders });
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
    return jsonError("Send profile details as JSON.", 415);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return jsonError("Profile details are too large.", 413);
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return jsonError("Profile details are not valid JSON.", 400);
  }
  const profile = validateProfile(parsedBody);
  if (!profile) {
    return jsonError("Check the restaurant profile fields and try again.", 400);
  }

  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Restaurant profile storage is not configured.", 503);
  }
  const url = createProfileUrl(configuration);
  url.searchParams.set("select", PROFILE_COLUMNS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: profile.name,
        logo_url: profile.logoUrl,
        cover_image_url: profile.coverImageUrl,
        address: profile.address,
        phone: profile.phone,
        opening_hours: profile.openingHours,
        currency: profile.currency,
        google_review_url: profile.googleReviewUrl,
      }),
    });
  } catch {
    return jsonError("Could not save the restaurant profile.", 502);
  }
  if (!response.ok) {
    return jsonError("Could not save the restaurant profile.", 502);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return jsonError("Saved profile data could not be read.", 502);
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    return jsonError("The configured restaurant was not found.", 404);
  }
  const savedProfile = mapProfile(rows[0]);
  if (!savedProfile) {
    return jsonError("Saved profile data is invalid.", 502);
  }
  return Response.json(
    { profile: savedProfile },
    { headers: noStoreHeaders },
  );
}
