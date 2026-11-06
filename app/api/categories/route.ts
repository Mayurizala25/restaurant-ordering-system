import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../lib/admin-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CATEGORY_SELECT = "id,name,description,image_url,sort_order,is_active";

type SupabaseConfiguration = {
  supabaseUrl: string;
  serviceRoleKey: string;
  restaurantId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function getConfiguration(): SupabaseConfiguration | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (!supabaseUrl || !serviceRoleKey || !restaurantId) return null;
  return { supabaseUrl, serviceRoleKey, restaurantId };
}

function getRestUrl(configuration: SupabaseConfiguration, table: string) {
  const url = new URL(`/rest/v1/${table}`, configuration.supabaseUrl);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password
  ) {
    throw new Error("Supabase URL is not secure.");
  }
  return url;
}

async function authorizeMutation(request: Request): Promise<Response | null> {
  const cookieStore = await cookies();
  if (!(await verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value))) {
    return jsonError("Admin authentication is required.", 401);
  }

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
    const expectedOrigin = new URL(`${requestProtocol}//${requestHost}`).origin;
    if (request.headers.get("origin") !== expectedOrigin) {
      return jsonError("Cross-origin category changes are not allowed.", 403);
    }
  } catch {
    return jsonError("Category change origin could not be verified.", 403);
  }
  return null;
}

function mapCategory(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.image_url !== "string" ||
    typeof value.sort_order !== "number" ||
    typeof value.is_active !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    imageUrl: value.image_url,
    sortOrder: value.sort_order,
    isActive: value.is_active,
  };
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const cookieStore = await cookies();
  let validSession: boolean;
  try {
    validSession = await verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  } catch {
    return jsonError("Admin session verification is temporarily unavailable. Try again.", 503);
  }
  if (!validSession) {
    return jsonError("Admin authentication is required.", 401);
  }
  const configuration = getConfiguration();
  if (!configuration) return jsonError("Supabase category storage is not configured.", 503);

  let categoriesUrl: URL;
  try {
    categoriesUrl = getRestUrl(configuration, "restaurant_categories");
  } catch {
    return jsonError("Supabase category storage is not configured securely.", 503);
  }
  categoriesUrl.searchParams.set("select", CATEGORY_SELECT);
  categoriesUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  categoriesUrl.searchParams.set("order", "sort_order.asc,name.asc");

  const timeoutSignal = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetch(categoriesUrl, {
      method: "GET",
      cache: "no-store",
      signal: timeoutSignal,
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Supabase category request timed out. Try again.", 504)
      : jsonError("Could not load categories from Supabase.", 502);
  }
  if (!response.ok) return jsonError("Could not load categories from Supabase.", 502);

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return timeoutSignal.aborted
      ? jsonError("Supabase category request timed out. Try again.", 504)
      : jsonError("Supabase returned unreadable category data.", 502);
  }
  if (!Array.isArray(rows)) return jsonError("Supabase returned invalid category data.", 502);
  const categories = rows.map(mapCategory);
  if (categories.some((category) => category === null)) {
    return jsonError("Supabase returned invalid category data.", 502);
  }
  return Response.json({ categories }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const authorizationError = await authorizeMutation(request);
  if (authorizationError) return authorizationError;

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonError("Send category details as JSON.", 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Category details are not valid JSON.", 400);
  }
  if (!isRecord(body) || !isValidCategory(body)) {
    return jsonError("Check the category name, description, image, and sort order.", 400);
  }

  const configuration = getConfiguration();
  if (!configuration) return jsonError("Supabase category storage is not configured.", 503);
  let categoriesUrl: URL;
  try {
    categoriesUrl = getRestUrl(configuration, "restaurant_categories");
  } catch {
    return jsonError("Supabase category storage is not configured securely.", 503);
  }
  categoriesUrl.searchParams.set("select", CATEGORY_SELECT);

  let response: Response;
  try {
    response = await fetch(categoriesUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: randomUUID(),
        restaurant_id: configuration.restaurantId,
        name: body.name.trim(),
        description: body.description.trim(),
        image_url: body.imageUrl.trim(),
        sort_order: body.sortOrder,
        is_active: body.isActive,
      }),
    });
  } catch {
    return jsonError("Could not save the category to Supabase.", 502);
  }
  if (!response.ok) {
    return jsonError(
      response.status === 400 || response.status === 409
        ? "Supabase rejected the category details."
        : "Could not save the category to Supabase.",
      response.status === 400 || response.status === 409 ? 422 : 502,
    );
  }
  const rows: unknown = await response.json().catch(() => null);
  const category = Array.isArray(rows) && rows.length === 1 ? mapCategory(rows[0]) : null;
  if (!category) return jsonError("Supabase did not confirm the category save.", 502);
  return Response.json({ category }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request) {
  const authorizationError = await authorizeMutation(request);
  if (authorizationError) return authorizationError;

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonError("Send category changes as JSON.", 415);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Category changes are not valid JSON.", 400);
  }
  if (
    !isRecord(body) ||
    typeof body.categoryId !== "string" ||
    !CATEGORY_ID_PATTERN.test(body.categoryId) ||
    !isValidCategory(body)
  ) {
    return jsonError("Check the category name, description, image, and sort order.", 400);
  }

  const configuration = getConfiguration();
  if (!configuration) return jsonError("Supabase category storage is not configured.", 503);
  let categoriesUrl: URL;
  try {
    categoriesUrl = getRestUrl(configuration, "restaurant_categories");
  } catch {
    return jsonError("Supabase category storage is not configured securely.", 503);
  }
  categoriesUrl.searchParams.set("id", `eq.${body.categoryId}`);
  categoriesUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  categoriesUrl.searchParams.set("select", CATEGORY_SELECT);

  let response: Response;
  try {
    response = await fetch(categoriesUrl, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: body.name.trim(),
        description: body.description.trim(),
        image_url: body.imageUrl.trim(),
        sort_order: body.sortOrder,
        is_active: body.isActive,
      }),
    });
  } catch {
    return jsonError("Could not update the category in Supabase.", 502);
  }
  if (!response.ok) {
    return jsonError("Could not update the category in Supabase.", 502);
  }
  const rows: unknown = await response.json().catch(() => null);
  const category = Array.isArray(rows) && rows.length === 1 ? mapCategory(rows[0]) : null;
  if (!category) return jsonError("Category not found for this restaurant.", 404);
  return Response.json({ category }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  const authorizationError = await authorizeMutation(request);
  if (authorizationError) return authorizationError;

  const categoryId = new URL(request.url).searchParams.get("id");
  if (!categoryId || !CATEGORY_ID_PATTERN.test(categoryId)) {
    return jsonError("Choose a valid category to delete.", 400);
  }
  const configuration = getConfiguration();
  if (!configuration) return jsonError("Supabase category storage is not configured.", 503);

  let itemsUrl: URL;
  let categoriesUrl: URL;
  try {
    itemsUrl = getRestUrl(configuration, "restaurant_menu_items");
    categoriesUrl = getRestUrl(configuration, "restaurant_categories");
  } catch {
    return jsonError("Supabase category storage is not configured securely.", 503);
  }
  itemsUrl.searchParams.set("select", "id");
  itemsUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  itemsUrl.searchParams.set("category_id", `eq.${categoryId}`);
  itemsUrl.searchParams.set("limit", "1");

  let linkedItemsResponse: Response;
  try {
    linkedItemsResponse = await fetch(itemsUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
      },
    });
  } catch {
    return jsonError("Could not verify whether products use this category.", 502);
  }
  if (!linkedItemsResponse.ok) {
    return jsonError("Could not verify whether products use this category.", 502);
  }
  const linkedItems: unknown = await linkedItemsResponse.json().catch(() => null);
  if (!Array.isArray(linkedItems)) {
    return jsonError("Could not verify whether products use this category.", 502);
  }
  if (linkedItems.length > 0) {
    return jsonError("Move or delete this category's products before deleting it.", 409);
  }

  categoriesUrl.searchParams.set("id", `eq.${categoryId}`);
  categoriesUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  categoriesUrl.searchParams.set("select", "id");
  let response: Response;
  try {
    response = await fetch(categoriesUrl, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
        Prefer: "return=representation",
      },
    });
  } catch {
    return jsonError("Could not delete the category from Supabase.", 502);
  }
  if (!response.ok) {
    const errorCode = await readErrorCode(response);
    if (errorCode === "23503" || response.status === 409) {
      return jsonError("Move or delete this category's products before deleting it.", 409);
    }
    return jsonError("Could not delete the category from Supabase.", 502);
  }
  const deletedRows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
    return jsonError("Category not found for this restaurant.", 404);
  }
  return Response.json({ deleted: categoryId }, { headers: noStoreHeaders });
}

function isValidCategory(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  name: string;
  description: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
} {
  if (
    typeof value.name !== "string" ||
    value.name.trim().length < 1 ||
    value.name.trim().length > 80 ||
    typeof value.description !== "string" ||
    value.description.length > 180 ||
    typeof value.imageUrl !== "string" ||
    value.imageUrl.length > 2048 ||
    typeof value.sortOrder !== "number" ||
    !Number.isSafeInteger(value.sortOrder) ||
    value.sortOrder < 1 ||
    typeof value.isActive !== "boolean"
  ) {
    return false;
  }
  if (!value.imageUrl.trim()) return true;
  try {
    const imageUrl = new URL(value.imageUrl.trim());
    return imageUrl.protocol === "http:" || imageUrl.protocol === "https:";
  } catch {
    return false;
  }
}
