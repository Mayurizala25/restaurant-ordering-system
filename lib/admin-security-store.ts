import "server-only";

type JsonRecord = Record<string, unknown>;
const ADMIN_SECURITY_RPC_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callAdminSecurityRpc(
  name: string,
  parameters: JsonRecord,
): Promise<unknown> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Admin security storage is not configured.");
  }

  let rpcUrl: URL;
  try {
    rpcUrl = new URL(`/rest/v1/rpc/${name}`, supabaseUrl);
  } catch {
    throw new Error("Admin security storage is not configured.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    rpcUrl.hostname,
  );
  if (
    (rpcUrl.protocol !== "https:" &&
      !(rpcUrl.protocol === "http:" && isLoopback)) ||
    rpcUrl.username ||
    rpcUrl.password
  ) {
    throw new Error("Admin security storage is not configured securely.");
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
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(ADMIN_SECURITY_RPC_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Admin security storage is unavailable.");
  }
  if (!response.ok) {
    throw new Error("Admin security storage is unavailable.");
  }

  try {
    const result: unknown = await response.json();
    return result;
  } catch {
    throw new Error("Admin security storage returned an invalid response.");
  }
}

export async function consumeAdminLoginAttempt(
  identifierHash: string,
): Promise<{ success: boolean; reset: number }> {
  const result = await callAdminSecurityRpc("consume_admin_login_attempt", {
    p_identifier_hash: identifierHash,
  });
  if (
    !isRecord(result) ||
    typeof result.allowed !== "boolean" ||
    typeof result.reset_at !== "number" ||
    !Number.isSafeInteger(result.reset_at)
  ) {
    throw new Error("Admin security storage returned an invalid response.");
  }

  return { success: result.allowed, reset: result.reset_at };
}

export async function isAdminSessionRevoked(
  tokenHash: string,
): Promise<boolean> {
  const result = await callAdminSecurityRpc("is_admin_session_revoked", {
    p_token_hash: tokenHash,
  });
  if (typeof result !== "boolean") {
    throw new Error("Admin security storage returned an invalid response.");
  }
  return result;
}

export async function revokeAdminSession(
  tokenHash: string,
  expiresAt: number,
): Promise<boolean> {
  const result = await callAdminSecurityRpc("revoke_admin_session", {
    p_token_hash: tokenHash,
    p_expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (typeof result !== "boolean") {
    throw new Error("Admin security storage returned an invalid response.");
  }
  return result;
}
