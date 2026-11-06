import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECENT_SCAN_LIMIT = 25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function mapScan(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.table_id !== "string" ||
    !UUID_PATTERN.test(value.table_id) ||
    value.qr_type !== "table_menu" ||
    typeof value.scanned_at !== "string" ||
    !Number.isFinite(Date.parse(value.scanned_at))
  ) {
    return null;
  }
  const tableRelation = value.restaurant_tables;
  const table = Array.isArray(tableRelation) ? tableRelation[0] : tableRelation;
  if (
    !isRecord(table) ||
    typeof table.table_number !== "number" ||
    !Number.isSafeInteger(table.table_number)
  ) {
    return null;
  }
  return {
    id: value.id,
    tableId: value.table_id,
    tableNumber: table.table_number,
    qrType: value.qr_type,
    scannedAt: value.scanned_at,
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
    return jsonError("Scan analytics are not configured.", 503);
  }

  let url: URL;
  try {
    url = new URL("/rest/v1/restaurant_qr_scan_events", supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopback)) ||
      url.username ||
      url.password
    ) {
      return jsonError("Scan analytics are not configured securely.", 503);
    }
  } catch {
    return jsonError("Scan analytics are not configured.", 503);
  }

  url.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  url.searchParams.set(
    "select",
    "id,table_id,qr_type,scanned_at,restaurant_tables(table_number)",
  );
  url.searchParams.set("order", "scanned_at.desc");
  url.searchParams.set("limit", String(RECENT_SCAN_LIMIT));

  let response: Response;
  const timeoutSignal = AbortSignal.timeout(10_000);
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: timeoutSignal,
      headers: {
        apikey: serviceRoleKey,
        Accept: "application/json",
        Prefer: "count=exact",
        Range: `0-${RECENT_SCAN_LIMIT - 1}`,
      },
    });
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Loading QR scan analytics timed out. Try again.", 504)
      : jsonError("Could not load QR scan analytics.", 502);
  }
  if (!response.ok) return jsonError("Could not load QR scan analytics.", 502);

  const totalMatch = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (!totalMatch) return jsonError("QR scan totals could not be read.", 502);

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Loading QR scan analytics timed out. Try again.", 504)
      : jsonError("QR scan activity could not be read.", 502);
  }
  if (!Array.isArray(rows)) {
    return jsonError("QR scan activity is invalid.", 502);
  }
  const mappedScans = rows.map(mapScan);
  if (mappedScans.some((scan) => scan === null)) {
    return jsonError("QR scan activity is invalid.", 502);
  }
  const scans = mappedScans.filter(
    (scan): scan is NonNullable<typeof scan> => scan !== null,
  );

  return Response.json(
    { totalScans: Number(totalMatch[1]), scans },
    { headers: noStoreHeaders },
  );
}
