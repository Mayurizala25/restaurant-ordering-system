import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE_COLUMNS =
  "id,table_number,name,seating_capacity,is_active";
const MAX_BODY_BYTES = 16_384;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

type TableInput = {
  tableNumber: number;
  name: string;
  seatingCapacity: number;
  isActive: boolean;
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
    const url = new URL("/rest/v1/restaurant_tables", supabaseUrl);
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
        return jsonError("Cross-origin table changes are not allowed.", 403);
      }
    } catch {
      return jsonError("Table change origin could not be verified.", 403);
    }
  }
  return null;
}

function mapTable(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.table_number !== "number" ||
    !Number.isSafeInteger(value.table_number) ||
    value.table_number < 1 ||
    value.table_number > MAX_POSTGRES_INTEGER ||
    typeof value.name !== "string" ||
    value.name.trim().length < 1 ||
    value.name.length > 60 ||
    typeof value.seating_capacity !== "number" ||
    !Number.isSafeInteger(value.seating_capacity) ||
    value.seating_capacity < 1 ||
    value.seating_capacity > MAX_POSTGRES_INTEGER ||
    typeof value.is_active !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    tableNumber: value.table_number,
    name: value.name,
    seatingCapacity: value.seating_capacity,
    isActive: value.is_active,
  };
}

function validateTable(value: unknown): TableInput | null {
  if (
    !isRecord(value) ||
    typeof value.tableNumber !== "number" ||
    !Number.isSafeInteger(value.tableNumber) ||
    value.tableNumber < 1 ||
    value.tableNumber > MAX_POSTGRES_INTEGER ||
    typeof value.name !== "string" ||
    value.name.trim().length < 1 ||
    value.name.trim().length > 60 ||
    typeof value.seatingCapacity !== "number" ||
    !Number.isSafeInteger(value.seatingCapacity) ||
    value.seatingCapacity < 1 ||
    value.seatingCapacity > MAX_POSTGRES_INTEGER ||
    typeof value.isActive !== "boolean"
  ) {
    return null;
  }
  return {
    tableNumber: value.tableNumber,
    name: value.name.trim(),
    seatingCapacity: value.seatingCapacity,
    isActive: value.isActive,
  };
}

function createTableUrl(
  configuration: NonNullable<ReturnType<typeof getConfiguration>>,
) {
  const url = new URL(configuration.url);
  url.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  return url;
}

async function parseTableInput(request: Request): Promise<TableInput | Response> {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return jsonError("Send table details as JSON.", 415);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return jsonError("Table details are too large.", 413);
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return jsonError("Table details are not valid JSON.", 400);
  }
  const table = validateTable(parsedBody);
  return table ?? jsonError("Check the table number, name, and seating capacity.", 400);
}

async function readDatabaseErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function GET() {
  let authorizationError: Response | null;
  try {
    authorizationError = await authorize();
  } catch {
    return jsonError(
      "Admin session verification is temporarily unavailable. Try again.",
      503,
    );
  }
  if (authorizationError) return authorizationError;

  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Restaurant table storage is not configured.", 503);
  }
  const url = createTableUrl(configuration);
  url.searchParams.set("select", TABLE_COLUMNS);
  url.searchParams.set("order", "table_number.asc");

  let response: Response;
  const timeoutSignal = AbortSignal.timeout(10_000);
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: timeoutSignal,
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Loading restaurant tables timed out. Try again.", 504)
      : jsonError("Could not load restaurant tables.", 502);
  }
  if (!response.ok) return jsonError("Could not load restaurant tables.", 502);

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Loading restaurant tables timed out. Try again.", 504)
      : jsonError("Supabase returned unreadable table data.", 502);
  }
  if (!Array.isArray(rows)) {
    return jsonError("Supabase returned invalid table data.", 502);
  }
  const tables = rows.map(mapTable);
  if (tables.some((table) => table === null)) {
    return jsonError("Supabase returned invalid table data.", 502);
  }
  return Response.json({ tables }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const authorizationError = await authorize(request);
  if (authorizationError) return authorizationError;

  const table = await parseTableInput(request);
  if (table instanceof Response) return table;
  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Restaurant table storage is not configured.", 503);
  }
  const url = new URL(configuration.url);
  url.searchParams.set("select", TABLE_COLUMNS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        Accept: "application/json",
      },
      body: JSON.stringify({
        restaurant_id: configuration.restaurantId,
        table_number: table.tableNumber,
        name: table.name,
        seating_capacity: table.seatingCapacity,
        is_active: table.isActive,
      }),
    });
  } catch {
    return jsonError("Could not save this table.", 502);
  }
  if (!response.ok) {
    const code = await readDatabaseErrorCode(response);
    return code === "23505"
      ? jsonError(`Table number ${table.tableNumber} is already in use.`, 409)
      : jsonError("Could not save this table.", 502);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return jsonError("Saved table data could not be read.", 502);
  }
  const savedTable = Array.isArray(rows) && rows.length === 1
    ? mapTable(rows[0])
    : null;
  if (!savedTable) return jsonError("Saved table data is invalid.", 502);
  return Response.json({ table: savedTable }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request) {
  const authorizationError = await authorize(request);
  if (authorizationError) return authorizationError;

  const requestUrl = new URL(request.url);
  const id = requestUrl.searchParams.get("id");
  if (!id || !UUID_PATTERN.test(id)) {
    return jsonError("Choose a valid table to update.", 400);
  }
  const table = await parseTableInput(request);
  if (table instanceof Response) return table;
  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Restaurant table storage is not configured.", 503);
  }
  const url = createTableUrl(configuration);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", TABLE_COLUMNS);

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
        table_number: table.tableNumber,
        name: table.name,
        seating_capacity: table.seatingCapacity,
        is_active: table.isActive,
      }),
    });
  } catch {
    return jsonError("Could not update this table.", 502);
  }
  if (!response.ok) {
    const code = await readDatabaseErrorCode(response);
    return code === "23505"
      ? jsonError(`Table number ${table.tableNumber} is already in use.`, 409)
      : jsonError("Could not update this table.", 502);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return jsonError("Updated table data could not be read.", 502);
  }
  const updatedTable = Array.isArray(rows) && rows.length === 1
    ? mapTable(rows[0])
    : null;
  if (!updatedTable) {
    return jsonError("The table was not found for this restaurant.", 404);
  }
  return Response.json({ table: updatedTable }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  const authorizationError = await authorize(request);
  if (authorizationError) return authorizationError;

  const requestUrl = new URL(request.url);
  const id = requestUrl.searchParams.get("id");
  if (!id || !UUID_PATTERN.test(id)) {
    return jsonError("Choose a valid table to delete.", 400);
  }
  const configuration = getConfiguration();
  if (!configuration) {
    return jsonError("Restaurant table storage is not configured.", 503);
  }
  const url = createTableUrl(configuration);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", "id");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Prefer: "return=representation",
        Accept: "application/json",
      },
    });
  } catch {
    return jsonError("Could not delete this table.", 502);
  }
  if (!response.ok) {
    const code = await readDatabaseErrorCode(response);
    return code === "23503"
      ? jsonError("Tables with existing orders cannot be deleted.", 409)
      : jsonError("Could not delete this table.", 502);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return jsonError("Deleted table data could not be read.", 502);
  }
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !isRecord(rows[0]) ||
    rows[0].id !== id
  ) {
    return jsonError("The table was not found for this restaurant.", 404);
  }
  return Response.json({ deleted: true }, { headers: noStoreHeaders });
}
