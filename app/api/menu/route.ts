const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStoreHeaders = { "Cache-Control": "no-store" };

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restaurantId = process.env.SUPABASE_RESTAURANT_ID;
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !restaurantId ||
    !UUID_PATTERN.test(restaurantId)
  ) {
    return jsonError("The restaurant menu is not configured.", 503);
  }

  let categoriesUrl: URL;
  let itemsUrl: URL;
  let tablesUrl: URL;
  try {
    categoriesUrl = new URL("/rest/v1/restaurant_categories", supabaseUrl);
    itemsUrl = new URL("/rest/v1/restaurant_menu_items", supabaseUrl);
    tablesUrl = new URL("/rest/v1/restaurant_tables", supabaseUrl);
    for (const url of [categoriesUrl, itemsUrl, tablesUrl]) {
      const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
        url.username ||
        url.password
      ) {
        return jsonError("The restaurant menu is not configured securely.", 503);
      }
    }
  } catch {
    return jsonError("The restaurant menu is not configured.", 503);
  }

  const headers = { apikey: serviceRoleKey, Accept: "application/json" };
  categoriesUrl.searchParams.set(
    "select",
    "id,name,description,image_url,sort_order",
  );
  categoriesUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  categoriesUrl.searchParams.set("is_active", "eq.true");
  categoriesUrl.searchParams.set("order", "sort_order.asc,name.asc");

  itemsUrl.searchParams.set(
    "select",
    "id,name,description,price_inr,image_url,category_id,is_available,sort_order",
  );
  itemsUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  itemsUrl.searchParams.set("is_available", "eq.true");
  itemsUrl.searchParams.set("order", "sort_order.asc,name.asc");
  tablesUrl.searchParams.set(
    "select",
    "id,table_number,name,seating_capacity,is_active",
  );
  tablesUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
  tablesUrl.searchParams.set("is_active", "eq.true");
  tablesUrl.searchParams.set("order", "table_number.asc");

  let categoriesResponse: Response;
  let itemsResponse: Response;
  let tablesResponse: Response;
  try {
    [categoriesResponse, itemsResponse, tablesResponse] = await Promise.all([
      fetch(categoriesUrl, { method: "GET", cache: "no-store", headers }),
      fetch(itemsUrl, { method: "GET", cache: "no-store", headers }),
      fetch(tablesUrl, { method: "GET", cache: "no-store", headers }),
    ]);
  } catch {
    return jsonError("Could not load the restaurant menu.", 502);
  }
  if (!categoriesResponse.ok || !itemsResponse.ok || !tablesResponse.ok) {
    return jsonError("Could not load the restaurant menu.", 502);
  }

  let categories: unknown;
  let items: unknown;
  let tables: unknown;
  try {
    [categories, items, tables] = await Promise.all([
      categoriesResponse.json(),
      itemsResponse.json(),
      tablesResponse.json(),
    ]);
  } catch {
    return jsonError("The restaurant menu response could not be read.", 502);
  }
  if (
    !Array.isArray(categories) ||
    !Array.isArray(items) ||
    !Array.isArray(tables)
  ) {
    return jsonError("The restaurant menu response could not be read.", 502);
  }

  const categoryIds = new Set<string>();
  const mappedCategories = [];
  for (const category of categories) {
    if (
      !isRecord(category) ||
      typeof category.id !== "string" ||
      typeof category.name !== "string" ||
      typeof category.description !== "string" ||
      typeof category.image_url !== "string" ||
      typeof category.sort_order !== "number"
    ) {
      return jsonError("The restaurant menu contains invalid category data.", 502);
    }
    categoryIds.add(category.id);
    mappedCategories.push({
      id: category.id,
      name: category.name,
      description: category.description,
      imageUrl: category.image_url,
      isActive: true,
      sortOrder: category.sort_order,
    });
  }

  const mappedItems = [];
  for (const item of items) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.description !== "string" ||
      (typeof item.price_inr !== "string" && typeof item.price_inr !== "number") ||
      !Number.isFinite(Number(item.price_inr)) ||
      typeof item.image_url !== "string" ||
      typeof item.category_id !== "string" ||
      typeof item.sort_order !== "number"
    ) {
      return jsonError("The restaurant menu contains invalid product data.", 502);
    }
    if (!categoryIds.has(item.category_id)) continue;
    mappedItems.push({
      id: item.id,
      name: item.name,
      description: item.description,
      priceINR: Number(item.price_inr),
      imageUrl: item.image_url,
      categoryId: item.category_id,
      isAvailable: true,
    });
  }

  const mappedTables = [];
  for (const table of tables) {
    if (
      !isRecord(table) ||
      typeof table.id !== "string" ||
      !UUID_PATTERN.test(table.id) ||
      typeof table.table_number !== "number" ||
      !Number.isSafeInteger(table.table_number) ||
      table.table_number < 1 ||
      typeof table.name !== "string" ||
      table.name.trim().length < 1 ||
      table.name.length > 60 ||
      typeof table.seating_capacity !== "number" ||
      !Number.isSafeInteger(table.seating_capacity) ||
      table.seating_capacity < 1 ||
      typeof table.is_active !== "boolean"
    ) {
      return jsonError("The restaurant menu contains invalid table data.", 502);
    }
    mappedTables.push({
      id: table.id,
      tableNumber: table.table_number,
      name: table.name,
      seatingCapacity: table.seating_capacity,
      isActive: table.is_active,
    });
  }

  return Response.json(
    {
      categories: mappedCategories,
      menuItems: mappedItems,
      tables: mappedTables,
    },
    { headers: noStoreHeaders },
  );
}