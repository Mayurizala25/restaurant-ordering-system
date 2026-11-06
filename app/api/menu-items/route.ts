import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "../../../lib/admin-session";

const MAX_BODY_BYTES = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStoreHeaders = { "Cache-Control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

async function authorizeMutation(request: Request): Promise<Response | null> {
  const cookieStore = await cookies();
  if (
    !(await verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value))
  ) {
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
      return jsonError("Cross-origin product changes are not allowed.", 403);
    }
  } catch {
    return jsonError("Product change origin could not be verified.", 403);
  }

  return null;
}

function getSupabaseConfiguration() {
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
  return { supabaseUrl, serviceRoleKey, restaurantId };
}

function createRestUrl(supabaseUrl: string, table: string): URL {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
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

function isMenuItemId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function mapMenuItem(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    (typeof value.price_inr !== "string" && typeof value.price_inr !== "number") ||
    !Number.isFinite(Number(value.price_inr)) ||
    typeof value.image_url !== "string" ||
    typeof value.category_id !== "string" ||
    typeof value.is_available !== "boolean" ||
    typeof value.sort_order !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    priceINR: Number(value.price_inr),
    imageUrl: value.image_url,
    categoryId: value.category_id,
    isAvailable: value.is_available,
    sortOrder: value.sort_order,
  };
}

async function isActiveCategory(
  categoryId: string,
  configuration: NonNullable<ReturnType<typeof getSupabaseConfiguration>>,
) {
  const categoriesUrl = createRestUrl(
    configuration.supabaseUrl,
    "restaurant_categories",
  );
  categoriesUrl.searchParams.set("select", "id,is_active");
  categoriesUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  categoriesUrl.searchParams.set("id", `eq.${categoryId}`);
  const response = await fetch(categoriesUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      apikey: configuration.serviceRoleKey,
      Accept: "application/json",
    },
  });
  if (!response.ok) return false;
  const rows: unknown = await response.json().catch(() => null);
  return (
    Array.isArray(rows) &&
    rows.some(
      (row) =>
        isRecord(row) && row.id === categoryId && row.is_active === true,
    )
  );
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

  const configuration = getSupabaseConfiguration();
  if (!configuration) {
    return jsonError("Supabase product storage is not configured.", 503);
  }

  let itemsUrl: URL;
  try {
    itemsUrl = createRestUrl(configuration.supabaseUrl, "restaurant_menu_items");
  } catch {
    return jsonError("Supabase product storage is not configured securely.", 503);
  }
  itemsUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  itemsUrl.searchParams.set(
    "select",
    "id,name,description,price_inr,image_url,category_id,is_available,sort_order",
  );
  itemsUrl.searchParams.set("order", "sort_order.asc,name.asc");

  const timeoutSignal = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetch(itemsUrl, {
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
      ? jsonError("Supabase menu item request timed out. Try again.", 504)
      : jsonError("Could not load products from Supabase.", 502);
  }
  if (!response.ok) {
    return jsonError("Could not load products from Supabase.", 502);
  }

  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows)) {
    return timeoutSignal.aborted
      ? jsonError("Supabase menu item request timed out. Try again.", 504)
      : jsonError("Supabase returned invalid product data.", 502);
  }
  const items = rows.map(mapMenuItem);
  if (items.some((item) => item === null)) {
    return jsonError("Supabase returned invalid product data.", 502);
  }
  return Response.json({ items }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (
    !(await verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    ))
  ) {
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
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(`${requestProtocol}//${requestHost}`).origin;
  } catch {
    return jsonError("Product creation origin could not be verified.", 403);
  }
  if (request.headers.get("origin") !== expectedOrigin) {
    return jsonError("Cross-origin product creation is not allowed.", 403);
  }

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return jsonError("Send product details as JSON.", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError("Product details are too large.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Product details are not valid JSON.", 400);
  }
  if (
    !isRecord(body) ||
    typeof body.name !== "string" ||
    body.name.trim().length < 1 ||
    body.name.trim().length > 160 ||
    typeof body.description !== "string" ||
    body.description.length > 300 ||
    typeof body.priceINR !== "number" ||
    !Number.isFinite(body.priceINR) ||
    body.priceINR < 0 ||
    Math.abs(body.priceINR * 100 - Math.round(body.priceINR * 100)) > 1e-8 ||
    typeof body.imageUrl !== "string" ||
    body.imageUrl.length > 2048 ||
    typeof body.categoryId !== "string" ||
    body.categoryId.trim().length < 1 ||
    body.categoryId.length > 128 ||
    typeof body.isAvailable !== "boolean" ||
    typeof body.sortOrder !== "number" ||
    !Number.isSafeInteger(body.sortOrder) ||
    body.sortOrder < 0
  ) {
    return jsonError("Check the product name, price, category, and details.", 400);
  }

  const imageUrl = body.imageUrl.trim();
  if (imageUrl) {
    try {
      const parsedImageUrl = new URL(imageUrl);
      if (parsedImageUrl.protocol !== "https:" && parsedImageUrl.protocol !== "http:") {
        throw new Error("Invalid image URL protocol.");
      }
    } catch {
      return jsonError("Enter a valid HTTP or HTTPS image URL, or leave it blank.", 400);
    }
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
    return jsonError("Supabase product storage is not configured.", 503);
  }

  let categoriesUrl: URL;
  let menuItemsUrl: URL;
  try {
    categoriesUrl = new URL("/rest/v1/restaurant_categories", supabaseUrl);
    menuItemsUrl = new URL("/rest/v1/restaurant_menu_items", supabaseUrl);
    for (const url of [categoriesUrl, menuItemsUrl]) {
      const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
        url.username ||
        url.password
      ) {
        return jsonError("Supabase product storage is not configured securely.", 503);
      }
    }
  } catch {
    return jsonError("Supabase product storage is not configured.", 503);
  }

  const headers = { apikey: serviceRoleKey, Accept: "application/json" };
  categoriesUrl.searchParams.set("select", "id,is_active");
  categoriesUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  categoriesUrl.searchParams.set("id", `eq.${body.categoryId.trim()}`);

  let categoryResponse: Response;
  try {
    categoryResponse = await fetch(categoriesUrl, {
      method: "GET",
      cache: "no-store",
      headers,
    });
  } catch {
    return jsonError("Could not verify the selected category with Supabase.", 502);
  }
  if (!categoryResponse.ok) {
    return jsonError("Could not verify the selected category with Supabase.", 502);
  }

  let categoryRows: unknown;
  try {
    categoryRows = await categoryResponse.json();
  } catch {
    return jsonError("Supabase returned an unreadable category response.", 502);
  }
  if (
    !Array.isArray(categoryRows) ||
    !categoryRows.some(
      (category) =>
        isRecord(category) &&
        category.id === body.categoryId &&
        category.is_active === true,
    )
  ) {
    return jsonError("Choose an active category saved for this restaurant.", 422);
  }

  const id = randomUUID();
  menuItemsUrl.searchParams.set(
    "select",
    "id,name,description,price_inr,image_url,category_id,is_available,sort_order",
  );
  let insertResponse: Response;
  try {
    insertResponse = await fetch(menuItemsUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id,
        restaurant_id: restaurantId,
        name: body.name.trim(),
        description: body.description.trim(),
        price_inr: body.priceINR,
        image_url: imageUrl,
        category_id: body.categoryId.trim(),
        is_available: body.isAvailable,
        sort_order: body.sortOrder,
      }),
    });
  } catch {
    return jsonError("Could not save the product to Supabase.", 502);
  }

  if (!insertResponse.ok) {
    if (insertResponse.status === 401 || insertResponse.status === 403) {
      return jsonError("Supabase rejected the product save. Check server configuration.", 503);
    }
    if (insertResponse.status === 400 || insertResponse.status === 409) {
      return jsonError("Supabase rejected the product details or category.", 422);
    }
    return jsonError("Could not save the product to Supabase.", 502);
  }

  let insertedRows: unknown;
  try {
    insertedRows = await insertResponse.json();
  } catch {
    return jsonError("Supabase saved the product but returned unreadable data.", 502);
  }
  if (!Array.isArray(insertedRows) || insertedRows.length !== 1) {
    return jsonError("Supabase did not confirm the product save.", 502);
  }

  const inserted = insertedRows[0];
  if (
    !isRecord(inserted) ||
    inserted.id !== id ||
    typeof inserted.name !== "string" ||
    typeof inserted.description !== "string" ||
    typeof inserted.price_inr !== "string" && typeof inserted.price_inr !== "number" ||
    typeof inserted.image_url !== "string" ||
    typeof inserted.category_id !== "string" ||
    typeof inserted.is_available !== "boolean" ||
    typeof inserted.sort_order !== "number"
  ) {
    return jsonError("Supabase returned incomplete product data.", 502);
  }

  return Response.json(
    {
      item: {
        id: inserted.id,
        name: inserted.name,
        description: inserted.description,
        priceINR: Number(inserted.price_inr),
        imageUrl: inserted.image_url,
        categoryId: inserted.category_id,
        isAvailable: inserted.is_available,
        sortOrder: inserted.sort_order,
      },
    },
    { headers: noStoreHeaders },
  );
}

export async function PATCH(request: Request) {
  const authorizationError = await authorizeMutation(request);
  if (authorizationError) return authorizationError;

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return jsonError("Send product changes as JSON.", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError("Product changes are too large.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Product changes are not valid JSON.", 400);
  }
  if (!isRecord(body) || !isMenuItemId(body.itemId)) {
    return jsonError("Choose a valid product to update.", 400);
  }

  const updates: Record<string, string | number | boolean> = {};
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 160) {
      return jsonError("Enter a valid product name.", 400);
    }
    updates.name = body.name.trim();
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 300) {
      return jsonError("Product descriptions must be 300 characters or fewer.", 400);
    }
    updates.description = body.description.trim();
  }
  if ("priceINR" in body) {
    if (
      typeof body.priceINR !== "number" ||
      !Number.isFinite(body.priceINR) ||
      body.priceINR < 0 ||
      Math.abs(body.priceINR * 100 - Math.round(body.priceINR * 100)) > 1e-8
    ) {
      return jsonError("Enter a valid non-negative price with up to two decimals.", 400);
    }
    updates.price_inr = body.priceINR;
  }
  if ("imageUrl" in body) {
    if (typeof body.imageUrl !== "string" || body.imageUrl.length > 2048) {
      return jsonError("Enter a valid HTTP or HTTPS image URL, or leave it blank.", 400);
    }
    const imageUrl = body.imageUrl.trim();
    if (imageUrl) {
      try {
        const parsedImageUrl = new URL(imageUrl);
        if (parsedImageUrl.protocol !== "https:" && parsedImageUrl.protocol !== "http:") {
          throw new Error("Invalid image URL protocol.");
        }
      } catch {
        return jsonError("Enter a valid HTTP or HTTPS image URL, or leave it blank.", 400);
      }
    }
    updates.image_url = imageUrl;
  }
  if ("categoryId" in body) {
    if (
      typeof body.categoryId !== "string" ||
      body.categoryId.trim().length < 1 ||
      body.categoryId.length > 128
    ) {
      return jsonError("Choose a valid category.", 400);
    }
    updates.category_id = body.categoryId.trim();
  }
  if ("isAvailable" in body) {
    if (typeof body.isAvailable !== "boolean") {
      return jsonError("Product availability must be true or false.", 400);
    }
    updates.is_available = body.isAvailable;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isSafeInteger(body.sortOrder) || body.sortOrder < 0) {
      return jsonError("Product sort order must be a non-negative whole number.", 400);
    }
    updates.sort_order = body.sortOrder;
  }
  if (Object.keys(updates).length === 0) {
    return jsonError("Provide at least one product field to update.", 400);
  }

  const configuration = getSupabaseConfiguration();
  if (!configuration) return jsonError("Supabase product storage is not configured.", 503);
  let currentCategoryId: string | null = null;
  if (typeof updates.category_id === "string") {
    let currentItemUrl: URL;
    try {
      currentItemUrl = createRestUrl(
        configuration.supabaseUrl,
        "restaurant_menu_items",
      );
    } catch {
      return jsonError("Supabase product storage is not configured securely.", 503);
    }
    currentItemUrl.searchParams.set("id", `eq.${body.itemId}`);
    currentItemUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
    currentItemUrl.searchParams.set("select", "id,category_id");

    let currentItemResponse: Response;
    try {
      currentItemResponse = await fetch(currentItemUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          apikey: configuration.serviceRoleKey,
          Accept: "application/json",
        },
      });
    } catch {
      return jsonError("Could not verify the product category with Supabase.", 502);
    }
    if (!currentItemResponse.ok) {
      return jsonError("Could not verify the product category with Supabase.", 502);
    }

    const currentItems: unknown = await currentItemResponse.json().catch(() => null);
    if (!Array.isArray(currentItems) || currentItems.length === 0) {
      return jsonError("Product not found for this restaurant.", 404);
    }
    if (
      !isRecord(currentItems[0]) ||
      typeof currentItems[0].category_id !== "string"
    ) {
      return jsonError("Supabase returned invalid product data.", 502);
    }
    currentCategoryId = currentItems[0].category_id;

    if (updates.category_id !== currentCategoryId) {
      let activeCategory = false;
      try {
        activeCategory = await isActiveCategory(updates.category_id, configuration);
      } catch {
        return jsonError("Could not verify the selected category with Supabase.", 502);
      }
      if (!activeCategory) {
        return jsonError("Choose an active category saved for this restaurant.", 422);
      }
    }
  }

  let itemUrl: URL;
  try {
    itemUrl = createRestUrl(configuration.supabaseUrl, "restaurant_menu_items");
  } catch {
    return jsonError("Supabase product storage is not configured securely.", 503);
  }
  itemUrl.searchParams.set("id", `eq.${body.itemId}`);
  itemUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  if (currentCategoryId !== null) {
    itemUrl.searchParams.set("category_id", `eq.${currentCategoryId}`);
  }
  itemUrl.searchParams.set(
    "select",
    "id,name,description,price_inr,image_url,category_id,is_available,sort_order",
  );

  let response: Response;
  try {
    response = await fetch(itemUrl, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    });
  } catch {
    return jsonError("Could not update the product in Supabase.", 502);
  }
  if (!response.ok) {
    return jsonError(
      response.status === 400 || response.status === 409
        ? "Supabase rejected the product changes. Check the product and category details."
        : "Could not update the product in Supabase.",
      response.status === 400 || response.status === 409 ? 422 : 502,
    );
  }

  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonError("Product not found for this restaurant.", 404);
  }
  const item = mapMenuItem(rows[0]);
  if (!item || item.id !== body.itemId) {
    return jsonError("Supabase returned incomplete product data.", 502);
  }
  return Response.json({ item }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  const authorizationError = await authorizeMutation(request);
  if (authorizationError) return authorizationError;

  const itemId = new URL(request.url).searchParams.get("id");
  if (!isMenuItemId(itemId)) {
    return jsonError("Choose a valid product to delete.", 400);
  }
  const configuration = getSupabaseConfiguration();
  if (!configuration) return jsonError("Supabase product storage is not configured.", 503);

  let itemUrl: URL;
  try {
    itemUrl = createRestUrl(configuration.supabaseUrl, "restaurant_menu_items");
  } catch {
    return jsonError("Supabase product storage is not configured securely.", 503);
  }
  itemUrl.searchParams.set("id", `eq.${itemId}`);
  itemUrl.searchParams.set("restaurant_id", `eq.${configuration.restaurantId}`);
  itemUrl.searchParams.set("select", "id");

  let response: Response;
  try {
    response = await fetch(itemUrl, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        apikey: configuration.serviceRoleKey,
        Accept: "application/json",
        Prefer: "return=representation",
      },
    });
  } catch {
    return jsonError("Could not delete the product from Supabase.", 502);
  }
  if (!response.ok) {
    return jsonError(
      response.status === 409
        ? "This product is used by existing orders and cannot be deleted."
        : "Could not delete the product from Supabase.",
      response.status === 409 ? 409 : 502,
    );
  }

  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonError("Product not found for this restaurant.", 404);
  }
  return Response.json({ deleted: itemId }, { headers: noStoreHeaders });
}