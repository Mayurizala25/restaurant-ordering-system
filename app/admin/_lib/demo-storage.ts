import { initialDemoData, type DemoData } from "./demo-data";

const STORAGE_KEY = "virtual-rudra.admin.demo-data";
const STORAGE_VERSION = 3;
const STANDARD_MENU_CATEGORIES = [
  "Starters",
  "Breakfast",
  "Brunch",
  "Lunch",
  "Dinner",
  "Pizza",
  "Pasta",
  "North Indian",
  "South Indian",
  "Chinese",
  "Desserts",
  "Beverages",
  "Snacks",
];

type StoredDemoData = {
  version: number;
  data: unknown;
};

type LegacyDemoData = Omit<DemoData, "tables"> & { tables?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategory(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.imageUrl === "string" &&
    typeof value.isActive === "boolean" &&
    Number.isSafeInteger(value.sortOrder)
  );
}

function isMenuItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.priceINR === "number" &&
    Number.isFinite(value.priceINR) &&
    value.priceINR >= 0 &&
    typeof value.imageUrl === "string" &&
    typeof value.categoryId === "string" &&
    typeof value.isAvailable === "boolean"
  );
}

function isDemoTable(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.tableNumber === "number" &&
    Number.isSafeInteger(value.tableNumber) &&
    value.tableNumber > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 60 &&
    typeof value.seatingCapacity === "number" &&
    Number.isSafeInteger(value.seatingCapacity) &&
    value.seatingCapacity > 0 &&
    typeof value.isActive === "boolean"
  );
}

function isLegacyDemoData(value: unknown): value is LegacyDemoData {
  if (
    !isRecord(value) ||
    !Array.isArray(value.categories) ||
    !value.categories.every(isCategory) ||
    !Array.isArray(value.menuItems) ||
    !value.menuItems.every(isMenuItem)
  ) {
    return false;
  }

  const categoryIds = new Set(value.categories.map((category) => category.id));
  return value.menuItems.every((item) => categoryIds.has(item.categoryId));
}

function isDemoTableArray(value: unknown): value is DemoData["tables"] {
  return Array.isArray(value) && value.every(isDemoTable);
}

function isDemoData(value: unknown): value is DemoData {
  if (!isRecord(value) || !isLegacyDemoData(value)) {
    return false;
  }

  const tables = value.tables;
  if (!isDemoTableArray(tables)) return false;
  return (
    new Set(tables.map((table) => table.id)).size === tables.length &&
    new Set(tables.map((table) => table.tableNumber)).size === tables.length
  );
}

function copyDemoData(data: DemoData): DemoData {
  return {
    categories: data.categories.map((category) => ({ ...category })),
    menuItems: data.menuItems.map((item) => ({ ...item })),
    tables: data.tables.map((table) => ({ ...table })),
  };
}

function addStandardCategories(data: LegacyDemoData): LegacyDemoData {
  const categories = data.categories.map((category) => ({ ...category }));
  const categoryNames = new Set(
    categories.map((category) => category.name.trim().toLowerCase()),
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  let nextSortOrder = Math.max(0, ...categories.map((category) => category.sortOrder)) + 1;

  for (const name of STANDARD_MENU_CATEGORIES) {
    if (categoryNames.has(name.toLowerCase())) continue;
    const template = initialDemoData.categories.find(
      (category) => category.name === name,
    );
    if (!template) {
      throw new Error(`Missing demo data for the "${name}" category.`);
    }

    let id = template.id;
    let suffix = 2;
    while (categoryIds.has(id)) {
      id = `${template.id}-${suffix}`;
      suffix += 1;
    }
    categories.push({ ...template, id, sortOrder: nextSortOrder });
    categoryIds.add(id);
    categoryNames.add(name.toLowerCase());
    nextSortOrder += 1;
  }

  return { ...data, categories };
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch (error) {
    throw new Error("Browser localStorage is unavailable.", { cause: error });
  }
}

function serialize(data: DemoData): string {
  const stored: StoredDemoData = { version: STORAGE_VERSION, data };
  return JSON.stringify(stored);
}

export function loadDemoData(): DemoData {
  const storage = getLocalStorage();
  if (!storage) return copyDemoData(initialDemoData);

  let serialized: string | null;
  try {
    serialized = storage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error("Could not read Virtual Rudra demo data from localStorage.", {
      cause: error,
    });
  }

  if (serialized === null) {
    const defaults = copyDemoData(initialDemoData);
    try {
      storage.setItem(STORAGE_KEY, serialize(defaults));
    } catch (error) {
      throw new Error("Could not initialize Virtual Rudra demo data.", {
        cause: error,
      });
    }
    return defaults;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Saved Virtual Rudra demo data is not valid JSON.", {
      cause: error,
    });
  }

  if (!isRecord(parsed) || !isRecord(parsed.data)) {
    throw new Error("Saved Virtual Rudra demo data is invalid or unsupported.");
  }

  if (parsed.version === 1 && isLegacyDemoData(parsed.data)) {
    const migrated: DemoData = {
      ...addStandardCategories(parsed.data),
      tables: initialDemoData.tables.map((table) => ({ ...table })),
    };
    saveDemoData(migrated);
    return migrated;
  }

  if (parsed.version === 2 && isDemoData(parsed.data)) {
    const augmented = addStandardCategories(parsed.data);
    const migrated: DemoData = {
      ...parsed.data,
      categories: augmented.categories,
    };
    saveDemoData(migrated);
    return migrated;
  }

  if (parsed.version !== STORAGE_VERSION || !isDemoData(parsed.data)) {
    throw new Error("Saved Virtual Rudra demo data is invalid or unsupported.");
  }

  return copyDemoData(parsed.data);
}

export function saveDemoData(data: DemoData): void {
  if (!isDemoData(data)) {
    throw new Error("Cannot save invalid Virtual Rudra demo data.");
  }

  const storage = getLocalStorage();
  if (!storage) {
    throw new Error("Cannot save Virtual Rudra demo data outside the browser.");
  }

  try {
    storage.setItem(STORAGE_KEY, serialize(data));
  } catch (error) {
    throw new Error("Could not save Virtual Rudra demo data to localStorage.", {
      cause: error,
    });
  }
}
