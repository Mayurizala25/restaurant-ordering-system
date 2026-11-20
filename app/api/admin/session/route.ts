import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { consumeAdminLoginAttempt } from "../../../../lib/admin-security-store";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
  isAdminSessionConfigured,
  revokeAdminSessionToken,
  verifyAdminCredentials,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    isPrivateIPv4(hostname)
  );
}

function isSameOriginLocalHttpRequest(
  origin: string | null,
  requestHost: string | null,
): boolean {
  if (!origin || !requestHost) return false;

  try {
    const originUrl = new URL(origin);
    return (
      originUrl.protocol === "http:" &&
      originUrl.host.toLowerCase() === requestHost.toLowerCase() &&
      isLocalDevelopmentHost(originUrl.hostname)
    );
  } catch {
    return false;
  }
}

function getCookieOptions(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim()
    .toLowerCase();
  const secure = !isSameOriginLocalHttpRequest(
    request.headers.get("origin"),
    request.headers.get("host"),
  ) && (
    requestUrl.protocol === "https:" ||
    forwardedProtocol === "https" ||
    (process.env.NODE_ENV === "production" &&
      !isLocalDevelopmentHost(requestUrl.hostname))
  );

  return {
    httpOnly: true,
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "strict" as const,
    secure,
  };
}

function getClientIp(request: Request): string | null {
  // These headers must be populated or overwritten by the trusted hosting proxy.
  const forwardedIp =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for");
  const ip = forwardedIp?.split(",", 1)[0].trim();
  if (ip) return ip;
  return process.env.NODE_ENV === "production" ? null : "development-local";
}

async function checkLoginRateLimit(request: Request) {
  const ip = getClientIp(request);
  if (!ip) return null;
  const identifier = createHash("sha256").update(ip).digest("hex");
  return consumeAdminLoginAttempt(identifier);
}

export async function GET() {
  if (!isAdminSessionConfigured()) {
    return Response.json(
      { authenticated: false, error: "Admin sign-in is not configured." },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSessionToken(token))) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: noStoreHeaders },
    );
  }

  return Response.json(
    { authenticated: true },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  if (!isAdminSessionConfigured()) {
    return Response.json(
      { error: "Admin sign-in is not configured." },
      { status: 503, headers: noStoreHeaders },
    );
  }

  let rateLimit: Awaited<ReturnType<typeof checkLoginRateLimit>>;
  try {
    rateLimit = await checkLoginRateLimit(request);
  } catch {
    rateLimit = null;
  }
  if (!rateLimit) {
    return Response.json(
      { error: "Sign-in is temporarily unavailable. Try again shortly." },
      { status: 503, headers: noStoreHeaders },
    );
  }
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000));
    return Response.json(
      { error: "Too many sign-in attempts. Try again later." },
      {
        status: 429,
        headers: { ...noStoreHeaders, "Retry-After": String(retryAfter) },
      },
    );
  }

  let credentials: unknown;
  try {
    credentials = await request.json();
  } catch {
    return Response.json(
      { error: "Enter a valid email address and password." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (
    typeof credentials !== "object" ||
    credentials === null ||
    !("email" in credentials) ||
    typeof credentials.email !== "string" ||
    !("password" in credentials) ||
    typeof credentials.password !== "string"
  ) {
    return Response.json(
      { error: "Enter a valid email address and password." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (!verifyAdminCredentials(credentials.email, credentials.password)) {
    return Response.json(
      { error: "Email or password is incorrect." },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(
    ADMIN_SESSION_COOKIE,
    createAdminSessionToken(),
    getCookieOptions(request),
  );
  return Response.json(
    { authenticated: true },
    { headers: noStoreHeaders },
  );
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await revokeAdminSessionToken(token))) {
    return Response.json(
      { error: "Could not securely end the admin session. Try again." },
      { status: 503, headers: noStoreHeaders },
    );
  }
  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    ...getCookieOptions(request),
    maxAge: 0,
  });
  return new Response(null, { status: 204, headers: noStoreHeaders });
}