const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1024;

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
    const url = new URL("/rest/v1/restaurant_qr_scan_events", supabaseUrl);
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

export async function POST(request: Request) {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return jsonError("Send scan details as JSON.", 415);
  }

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return jsonError("Scan details are too large.", 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonError("Scan details are not valid JSON.", 400);
  }
  if (
    !isRecord(body) ||
    typeof body.tableId !== "string" ||
    !UUID_PATTERN.test(body.tableId) ||
    body.qrType !== "table_menu"
  ) {
    return jsonError("The table QR code is invalid.", 400);
  }

  const configuration = getConfiguration();
  if (!configuration) return jsonError("Scan analytics are not configured.", 503);

  const tableUrl = new URL("/rest/v1/restaurant_tables", configuration.url);
  tableUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  tableUrl.searchParams.set("id", `eq.${body.tableId}`);
  tableUrl.searchParams.set("is_active", "eq.true");
  tableUrl.searchParams.set("select", "id");
  tableUrl.searchParams.set("limit", "1");

  let tableResponse: Response;
  try {
    tableResponse = await fetch(tableUrl, {
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return jsonError("Could not verify the scanned table.", 502);
  }
  if (!tableResponse.ok) {
    return jsonError("Could not verify the scanned table.", 502);
  }
  let tables: unknown;
  try {
    tables = await tableResponse.json();
  } catch {
    return jsonError("Table verification data could not be read.", 502);
  }
  if (!Array.isArray(tables) || tables.length !== 1) {
    return jsonError("This table QR code is unavailable.", 404);
  }

  let response: Response;
  try {
    response = await fetch(configuration.url, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        restaurant_id: configuration.restaurantId,
        table_id: body.tableId,
        qr_type: body.qrType,
      }),
    });
  } catch {
    return jsonError("Could not record this QR scan.", 502);
  }
  if (!response.ok) return jsonError("Could not record this QR scan.", 502);

  return Response.json({ recorded: true }, { headers: noStoreHeaders });
}
