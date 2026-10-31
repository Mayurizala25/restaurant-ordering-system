import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const INDIA_OFFSET_MINUTES = 330;

type SupabaseConfiguration = {
  supabaseUrl: string;
  serviceRoleKey: string;
  restaurantId: string;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function createOrdersUrl(configuration: SupabaseConfiguration) {
  const url = new URL("/rest/v1/restaurant_orders", configuration.supabaseUrl);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password
  ) {
    throw new Error("Supabase URL is not secure.");
  }
  url.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  return url;
}

function getIndiaDayBounds(now: Date) {
  const indiaTime = new Date(
    now.getTime() + INDIA_OFFSET_MINUTES * 60_000,
  );
  const start = Date.UTC(
    indiaTime.getUTCFullYear(),
    indiaTime.getUTCMonth(),
    indiaTime.getUTCDate(),
  ) - INDIA_OFFSET_MINUTES * 60_000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60_000).toISOString(),
  };
}

async function getOrderCount(
  configuration: SupabaseConfiguration,
  filters: Record<string, string> = {},
) {
  const url = createOrdersUrl(configuration);
  url.searchParams.set("select", "id");
  for (const [field, value] of Object.entries(filters)) {
    url.searchParams.set(field, value);
  }

  const response = await fetch(url, {
    method: "HEAD",
    cache: "no-store",
    headers: {
      apikey: configuration.serviceRoleKey,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!response.ok) throw new Error("Could not count restaurant orders.");

  const count = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (!count) throw new Error("Restaurant order count was unavailable.");
  const total = Number(count[1]);
  if (!Number.isSafeInteger(total)) {
    throw new Error("Restaurant order count was invalid.");
  }
  return total;
}

async function getRevenue(configuration: SupabaseConfiguration) {
  let offset = 0;
  let totalPaise = 0;

  while (true) {
    const url = createOrdersUrl(configuration);
    url.searchParams.set("select", "total_inr");
    url.searchParams.set("status", "neq.cancelled");
    url.searchParams.set("order", "created_at.asc,id.asc");

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
        Prefer: "count=exact",
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });
    if (!response.ok) throw new Error("Could not load restaurant revenue.");

    const countMatch = response.headers.get("content-range")?.match(/\/(\d+)$/);
    if (!countMatch) throw new Error("Restaurant revenue total was unavailable.");
    const rowCount = Number(countMatch[1]);
    if (!Number.isSafeInteger(rowCount)) {
      throw new Error("Restaurant revenue total was invalid.");
    }

    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Restaurant revenue data was invalid.");
    if (rows.length === 0 && offset < rowCount) {
      throw new Error("Restaurant revenue data was incomplete.");
    }

    for (const row of rows) {
      if (
        typeof row !== "object" ||
        row === null ||
        !("total_inr" in row) ||
        (typeof row.total_inr !== "number" &&
          typeof row.total_inr !== "string") ||
        !Number.isFinite(Number(row.total_inr))
      ) {
        throw new Error("Restaurant revenue data was invalid.");
      }
      totalPaise += Math.round(Number(row.total_inr) * 100);
      if (!Number.isSafeInteger(totalPaise)) {
        throw new Error("Restaurant revenue total was invalid.");
      }
    }

    offset += rows.length;
    if (offset >= rowCount) break;
  }

  return totalPaise / 100;
}

export async function GET() {
  const cookieStore = await cookies();
  if (
    !(await verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    ))
  ) {
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
    return jsonError("Dashboard statistics are not configured.", 503);
  }

  const configuration = { supabaseUrl, serviceRoleKey, restaurantId };
  try {
    createOrdersUrl(configuration);
  } catch {
    return jsonError("Dashboard statistics are not configured securely.", 503);
  }

  const { start, end } = getIndiaDayBounds(new Date());
  try {
    const [
      totalOrders,
      todayOrders,
      pendingOrders,
      completedOrders,
      revenueINR,
    ] = await Promise.all([
      getOrderCount(configuration),
      getOrderCount(configuration, {
        created_at: `gte.${start}`,
        and: `(created_at.lt.${end})`,
      }),
      getOrderCount(configuration, { status: "eq.pending" }),
      getOrderCount(configuration, { status: "eq.served" }),
      getRevenue(configuration),
    ]);

    return Response.json(
      {
        totalOrders,
        todayOrders,
        pendingOrders,
        completedOrders,
        revenueINR,
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return jsonError("Could not load dashboard statistics from Supabase.", 502);
  }
}
