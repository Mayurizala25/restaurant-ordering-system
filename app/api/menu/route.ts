const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStoreHeaders = { "Cache-Control": "no-store" };
type MenuResource = "categories" | "items" | "tables" | "restaurant";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function getFetchFailureType(error: unknown): "timeout" | "network" | "unknown" {
  if (!(error instanceof Error)) return "unknown";
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return "timeout";
  }
  return error.name === "TypeError" ? "network" : "unknown";
}

async function fetchMenuResource(
  resource: MenuResource,
  url: URL,
  headers: HeadersInit,
  signal: AbortSignal,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers,
      signal,
    });
    console.info("Supabase menu read completed", {
      resource,
      durationMs: Date.now() - startedAt,
      status: response.status,
    });
    return response;
  } catch (error) {
    console.error("Supabase menu read failed", {
      resource,
      stage: "fetch",
      durationMs: Date.now() - startedAt,
      failureType: getFetchFailureType(error),
    });
    throw error;
  }
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
  let restaurantUrl: URL;
  try {
    categoriesUrl = new URL("/rest/v1/restaurant_categories", supabaseUrl);
    itemsUrl = new URL("/rest/v1/restaurant_menu_items", supabaseUrl);
    tablesUrl = new URL("/rest/v1/restaurant_tables", supabaseUrl);
    restaurantUrl = new URL("/rest/v1/restaurant_restaurants", supabaseUrl);
    for (const url of [categoriesUrl, itemsUrl, tablesUrl, restaurantUrl]) {
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

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
  };
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
  restaurantUrl.searchParams.set("select", "id,tax_rate_percent");
  restaurantUrl.searchParams.set("id", `eq.${restaurantId}`);
  restaurantUrl.searchParams.set("limit", "1");

  let categoriesResponse: Response;
  let itemsResponse: Response;
  let tablesResponse: Response;
  let restaurantResponse: Response;
  const signal = AbortSignal.timeout(15_000);
  try {
    [
      categoriesResponse,
      itemsResponse,
      tablesResponse,
      restaurantResponse,
    ] = await Promise.all([
      fetchMenuResource("categories", categoriesUrl, headers, signal),
      fetchMenuResource("items", itemsUrl, headers, signal),
      fetchMenuResource("tables", tablesUrl, headers, signal),
      fetchMenuResource("restaurant", restaurantUrl, headers, signal),
    ]);
  } catch {
    return jsonError("Could not load the restaurant menu.", 502);
  }
  if (
    !categoriesResponse.ok ||
    !itemsResponse.ok ||
    !tablesResponse.ok ||
    !restaurantResponse.ok
  ) {
    for (const [resource, response] of [
      ["categories", categoriesResponse],
      ["items", itemsResponse],
      ["tables", tablesResponse],
      ["restaurant", restaurantResponse],
    ] as const) {
      if (!response.ok) {
        console.error("Supabase menu read returned a non-success status", {
          resource,
          status: response.status,
        });
      }
    }
    return jsonError("Could not load the restaurant menu.", 502);
  }

  let categories: unknown;
  let items: unknown;
  let tables: unknown;
  let restaurants: unknown;
  const menuResponses: [MenuResource, Response][] = [
    ["categories", categoriesResponse],
    ["items", itemsResponse],
    ["tables", tablesResponse],
    ["restaurant", restaurantResponse],
  ];
  try {
    [categories, items, tables, restaurants] = await Promise.all(
      menuResponses.map(async ([resource, response]) => {
        const startedAt = Date.now();
        try {
          return await response.json();
        } catch (error) {
          console.error("Supabase menu response could not be read", {
            resource,
            stage: "body",
            durationMs: Date.now() - startedAt,
            failureType: "response_read",
          });
          throw error;
        }
      }),
    );
  } catch {
    return jsonError("The restaurant menu response could not be read.", 502);
  }
  if (
    !Array.isArray(categories) ||
    !Array.isArray(items) ||
    !Array.isArray(tables) ||
    !Array.isArray(restaurants) ||
    restaurants.length !== 1 ||
    !isRecord(restaurants[0]) ||
    restaurants[0].id !== restaurantId ||
    (typeof restaurants[0].tax_rate_percent !== "string" &&
      typeof restaurants[0].tax_rate_percent !== "number") ||
    !Number.isFinite(Number(restaurants[0].tax_rate_percent)) ||
    Number(restaurants[0].tax_rate_percent) < 0 ||
    Number(restaurants[0].tax_rate_percent) > 100
  ) {
    return jsonError("The restaurant menu response could not be read.", 502);
  }
  const taxRatePercent = Number(restaurants[0].tax_rate_percent);
  if (Number(taxRatePercent.toFixed(2)) !== taxRatePercent) {
    return jsonError("The restaurant menu contains an invalid tax rate.", 502);
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
      taxRatePercent,
    },
    { headers: noStoreHeaders },
  );
}