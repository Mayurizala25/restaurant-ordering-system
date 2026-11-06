import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  isAdminSessionRevoked,
  revokeAdminSession,
} from "./admin-security-store";

export const ADMIN_SESSION_COOKIE = "virtual_rudra_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type AdminSessionConfiguration = {
  email: string;
  password: string;
  secret: string;
};

const COMMON_DEFAULT_ADMIN_PASSWORDS = new Set([
  "admin",
  "admin123",
  "change-me",
  "changeme",
  "default",
  "password",
  "password123",
  "replace-me",
  "your-password",
]);

function getConfiguration(): AdminSessionConfiguration | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (
    !email ||
    !password ||
    !secret ||
    secret.length < 32 ||
    (process.env.NODE_ENV === "production" && !isStrongProductionPassword(password))
  ) {
    return null;
  }
  return { email, password, secret };
}

function isStrongProductionPassword(password: string): boolean {
  if (password.length < 16) return false;
  if (COMMON_DEFAULT_ADMIN_PASSWORDS.has(password.trim().toLowerCase())) {
    return false;
  }

  const characterClasses = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
  return characterClasses.filter((pattern) => pattern.test(password)).length >= 3;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function isAdminSessionConfigured(): boolean {
  return getConfiguration() !== null;
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  const configuration = getConfiguration();
  if (!configuration) return false;
  return (
    email.trim().toLowerCase() === configuration.email &&
    constantTimeEqual(password, configuration.password)
  );
}

export function createAdminSessionToken(): string {
  const configuration = getConfiguration();
  if (!configuration) throw new Error("Admin session is not configured.");

  const payload = Buffer.from(
    JSON.stringify({
      role: "admin",
      expiresAt: Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS,
      sessionId: randomUUID(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", configuration.secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function getTokenExpiration(token: string | undefined): number | null {
  const configuration = getConfiguration();
  if (!configuration || !token || token.length > 2048) return null;

  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expectedSignature = createHmac("sha256", configuration.secret)
      .update(payload)
      .digest();
    const receivedSignature = Buffer.from(signature, "base64url");
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return null;
    }

    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      typeof claims === "object" &&
      claims !== null &&
      "role" in claims &&
      claims.role === "admin" &&
      "expiresAt" in claims &&
      typeof claims.expiresAt === "number" &&
      claims.expiresAt > Math.floor(Date.now() / 1000)
    ) {
      return claims.expiresAt;
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyAdminSessionToken(
  token: string | undefined,
): Promise<boolean> {
  if (!token || getTokenExpiration(token) === null) return false;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return !(await isAdminSessionRevoked(tokenHash));
}

export async function revokeAdminSessionToken(
  token: string | undefined,
): Promise<boolean> {
  const expiresAt = getTokenExpiration(token);
  if (!token || expiresAt === null) return true;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return true;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  try {
    return await revokeAdminSession(tokenHash, expiresAt);
  } catch {
    return false;
  }
}