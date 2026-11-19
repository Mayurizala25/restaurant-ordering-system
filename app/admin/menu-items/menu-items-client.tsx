"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoCategory, DemoData, DemoMenuItem } from "../_lib/demo-data";
import { loadDemoData, saveDemoData } from "../_lib/demo-storage";
import { AdminPageHeading } from "../_components/admin-page";
import {
  createTimeoutSignal,
  fetchJsonWithTimeout,
  RequestCancelledError,
  RequestTimeoutError,
} from "../_lib/request-timeout";

type ItemForm = {
  name: string;
  description: string;
  price: string;
  categoryId: string;
  imageUrl: string;
  isAvailable: boolean;
};

const inputClass =
  "h-11 w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 text-sm text-[#202521] outline-none transition placeholder:text-[#929a93] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15";
const emptyForm: ItemForm = {
  name: "",
  description: "",
  price: "",
  categoryId: "",
  imageUrl: "",
  isAvailable: true,
};
const emptyCategories: DemoCategory[] = [];
const emptyItems: DemoMenuItem[] = [];
const emptyDemoData: DemoData = { categories: [], menuItems: [], tables: [] };
const formatINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const DEMO_DATA_KEY = "virtual-rudra.admin.demo-data";
const standardCategoryOrder = [
  "starters",
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "pizza",
  "pasta",
  "north indian",
  "south indian",
  "chinese",
  "desserts",
  "beverages",
  "snacks",
];
const categoryPriority = new Map(
  standardCategoryOrder.map((name, index) => [name, index]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDemoMenuItem(value: unknown): value is DemoMenuItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.priceINR === "number" &&
    Number.isFinite(value.priceINR) &&
    typeof value.imageUrl === "string" &&
    typeof value.categoryId === "string" &&
    typeof value.isAvailable === "boolean"
  );
}

function isDemoCategory(value: unknown): value is DemoCategory {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.imageUrl === "string" &&
    typeof value.isActive === "boolean" &&
    typeof value.sortOrder === "number"
  );
}

export default function AdminMenuItemsClient() {
  const [data, setData] = useState<DemoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [processingItemId, setProcessingItemId] = useState<string | null>(null);
  const loadInFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);

  async function refreshData() {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      let localData = emptyDemoData;
      try {
        localData = loadDemoData();
      } catch {
        localData = emptyDemoData;
      }
      const [
        { response: itemsResponse, payload: itemsPayload },
        { response: categoriesResponse, payload: categoriesPayload },
      ] = await Promise.all([
        fetchJsonWithTimeout(
          "/api/menu-items",
          { cache: "no-store", signal: controller.signal },
          15_000,
        ),
        fetchJsonWithTimeout(
          "/api/categories",
          { cache: "no-store", signal: controller.signal },
          15_000,
        ),
      ]);
      if (!itemsResponse.ok) {
        throw new Error(
          isRecord(itemsPayload) && typeof itemsPayload.error === "string"
            ? itemsPayload.error
            : "Could not load products from Supabase.",
        );
      }
      if (
        !isRecord(itemsPayload) ||
        !Array.isArray(itemsPayload.items) ||
        !itemsPayload.items.every(isDemoMenuItem)
      ) {
        throw new Error("Supabase returned invalid product data.");
      }
      if (!categoriesResponse.ok) {
        throw new Error(
          isRecord(categoriesPayload) && typeof categoriesPayload.error === "string"
            ? categoriesPayload.error
            : "Could not load categories from Supabase.",
        );
      }
      if (
        !isRecord(categoriesPayload) ||
        !Array.isArray(categoriesPayload.categories) ||
        !categoriesPayload.categories.every(isDemoCategory)
      ) {
        throw new Error("Supabase returned invalid category data.");
      }
      setData({
        ...localData,
        categories: categoriesPayload.categories,
        menuItems: itemsPayload.items,
      });
      setLoadError("");
    } catch (cause) {
      if (!(cause instanceof RequestCancelledError)) {
        setLoadError(
          cause instanceof RequestTimeoutError
            ? "Loading menu items timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load products from Supabase.",
        );
      }
    } finally {
      loadInFlight.current = false;
      if (loadController.current === controller) loadController.current = null;
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) void refreshData();
    }, 0);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === DEMO_DATA_KEY) void refreshData();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshData();
    };
    window.addEventListener("storage", handleStorage);
    const handleFocus = () => void refreshData();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    window.addEventListener("virtual-rudra:refresh", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
      window.removeEventListener("virtual-rudra:refresh", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      loadController.current?.abort();
    };
  }, []);

  const categories = data?.categories ?? emptyCategories;
  const items = data?.menuItems ?? emptyItems;
  const sortedCategories = useMemo(
    () =>
      categories.toSorted((left, right) => {
        const leftPriority =
          categoryPriority.get(left.name.trim().toLowerCase()) ??
          Number.MAX_SAFE_INTEGER;
        const rightPriority =
          categoryPriority.get(right.name.trim().toLowerCase()) ??
          Number.MAX_SAFE_INTEGER;
        return leftPriority - rightPriority || left.sortOrder - right.sortOrder;
      }),
    [categories],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const availableCount = items.filter((item) => item.isAvailable).length;
  const activeCategoryCount = categories.filter((category) => category.isActive).length;
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => categoryFilter === "all" || item.categoryId === categoryFilter)
      .filter((item) => {
        const categoryName =
          categories.find((category) => category.id === item.categoryId)?.name ?? "";
        return (
          item.name.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          categoryName.toLowerCase().includes(query)
        );
      });
  }, [categories, categoryFilter, items, search]);
  const visibleItems = useMemo(
    () =>
      sortedCategories.flatMap((category) =>
        filteredItems
          .filter((item) => item.categoryId === category.id)
          .map((item) => ({ item, category })),
      ),
    [filteredItems, sortedCategories],
  );
  function resetForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      categoryId: categories.find((category) => category.isActive)?.id ?? "",
    });
  }

  function openAddModal() {
    resetForm();
    setActionError("");
    setFeedback("");
    setIsUploadingImage(false);
    setIsModalOpen(true);
  }

  function openEditModal(item: DemoMenuItem) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description,
      price: String(item.priceINR),
      categoryId: item.categoryId,
      imageUrl: item.imageUrl,
      isAvailable: item.isAvailable,
    });
    setActionError("");
    setFeedback("");
    setIsUploadingImage(false);
    setIsModalOpen(true);
  }

  async function uploadMenuItemImage(file: File) {
    setActionError("");
    setFeedback("");
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      setActionError("Choose an image between 1 byte and 5 MiB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) {
      setActionError("Use a JPEG, PNG, WebP, or AVIF image.");
      return;
    }

    setIsUploadingImage(true);
    const signal = createTimeoutSignal(30_000);
    try {
      const body = new FormData();
      body.set("image", file);
      const response = await fetch("/api/admin/menu-item-image", {
        method: "POST",
        body,
        cache: "no-store",
        signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not upload the menu item image.",
        );
      }
      if (!isRecord(payload) || typeof payload.imageUrl !== "string") {
        throw new Error("Supabase did not return the uploaded image URL.");
      }
      const imageUrl = payload.imageUrl;
      setForm((current) => ({ ...current, imageUrl }));
      setFeedback("Image uploaded. Save the menu item to apply it.");
    } catch (cause) {
      setActionError(
        signal.aborted
          ? "Uploading the menu item image timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not upload the menu item image.",
      );
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function saveItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    setFeedback("");
    if (!data) {
      setActionError("Menu data is not available. Reload the page and try again.");
      return;
    }

    const name = form.name.trim();
    const description = form.description.trim();
    const priceINR = Number(form.price);
    if (!name) {
      setActionError("Enter a menu item name.");
      return;
    }
    if (name.length > 100) {
      setActionError("Menu item names must be 100 characters or fewer.");
      return;
    }
    if (items.some((item) =>
      item.id !== editingId && item.name.toLowerCase() === name.toLowerCase(),
    )) {
      setActionError("A menu item with this name already exists.");
      return;
    }
    if (description.length > 300) {
      setActionError("Descriptions must be 300 characters or fewer.");
      return;
    }
    if (
      !/^\d+(\.\d{1,2})?$/.test(form.price.trim()) ||
      !Number.isFinite(priceINR) ||
      priceINR < 0
    ) {
      setActionError("Enter a valid, non-negative price in INR.");
      return;
    }
    const category = categories.find((entry) => entry.id === form.categoryId);
    if (!category) {
      setActionError(
        categories.length
          ? "Choose an existing category for this item."
          : "Create a category before adding menu items.",
      );
      return;
    }
    const imageUrl = form.imageUrl.trim();
    if (imageUrl) {
      try {
        const image = new URL(imageUrl);
        if (image.protocol !== "https:" && image.protocol !== "http:") {
          throw new Error("invalid protocol");
        }
      } catch {
        setActionError("Enter a valid http or https image URL, or leave it blank.");
        return;
      }
    }

    setIsSaving(true);
    const existing = items.find((item) => item.id === editingId);
    const signal = createTimeoutSignal(20_000);
    try {
      let updatedItem: DemoMenuItem;
      if (existing) {
        const response = await fetch("/api/menu-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: existing.id,
            name,
            description,
            priceINR,
            imageUrl,
            categoryId: category.id,
            isAvailable: form.isAvailable,
            sortOrder: items.indexOf(existing),
          }),
          cache: "no-store",
          signal,
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not update the product in Supabase.",
          );
        }
        if (!isRecord(payload) || !isRecord(payload.item)) {
          throw new Error("Supabase did not return the updated product.");
        }
        const savedItem = payload.item;
        if (
          typeof savedItem.id !== "string" ||
          typeof savedItem.name !== "string" ||
          typeof savedItem.description !== "string" ||
          typeof savedItem.priceINR !== "number" ||
          !Number.isFinite(savedItem.priceINR) ||
          typeof savedItem.imageUrl !== "string" ||
          typeof savedItem.categoryId !== "string" ||
          typeof savedItem.isAvailable !== "boolean"
        ) {
          throw new Error("Supabase returned incomplete product data.");
        }
        updatedItem = {
          id: savedItem.id,
          name: savedItem.name,
          description: savedItem.description,
          priceINR: savedItem.priceINR,
          imageUrl: savedItem.imageUrl,
          categoryId: savedItem.categoryId,
          isAvailable: savedItem.isAvailable,
        };
      } else {
        const response = await fetch("/api/menu-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            priceINR,
            imageUrl,
            categoryId: category.id,
            isAvailable: form.isAvailable,
            sortOrder: items.length,
          }),
          cache: "no-store",
          signal,
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          const message =
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not save the product to Supabase.";
          throw new Error(message);
        }
        if (!isRecord(payload) || !isRecord(payload.item)) {
          throw new Error("Supabase did not return the saved product.");
        }

        const savedItem = payload.item;
        if (
          typeof savedItem.id !== "string" ||
          typeof savedItem.name !== "string" ||
          typeof savedItem.description !== "string" ||
          typeof savedItem.priceINR !== "number" ||
          !Number.isFinite(savedItem.priceINR) ||
          typeof savedItem.imageUrl !== "string" ||
          typeof savedItem.categoryId !== "string" ||
          typeof savedItem.isAvailable !== "boolean"
        ) {
          throw new Error("Supabase returned incomplete product data.");
        }
        updatedItem = {
          id: savedItem.id,
          name: savedItem.name,
          description: savedItem.description,
          priceINR: savedItem.priceINR,
          imageUrl: savedItem.imageUrl,
          categoryId: savedItem.categoryId,
          isAvailable: savedItem.isAvailable,
        };
      }

      const nextData: DemoData = {
        ...data,
        menuItems: existing
          ? data.menuItems.map((item) => item.id === existing.id ? updatedItem : item)
          : [...data.menuItems, updatedItem],
      };
      setData(nextData);
      let cacheError = "";
      try {
        saveDemoData(nextData);
      } catch {
        cacheError = "Saved to Supabase, but the local menu cache could not be updated.";
      }
      setIsModalOpen(false);
      resetForm();
      setFeedback(
        cacheError ||
          (existing ? `"${name}" was updated.` : `"${name}" was added to the menu.`),
      );
    } catch (cause) {
      setActionError(
        signal.aborted
          ? "Saving the menu item timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not save this menu item.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteItem(item: DemoMenuItem) {
    setActionError("");
    setFeedback("");
    if (!data) return;
    if (!window.confirm(`Delete "${item.name}" from the menu? This cannot be undone.`)) {
      return;
    }
    setProcessingItemId(item.id);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch(
        `/api/menu-items?id=${encodeURIComponent(item.id)}`,
        { method: "DELETE", cache: "no-store", signal },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not delete the product from Supabase.",
        );
      }
      const nextData: DemoData = {
        ...data,
        menuItems: data.menuItems.filter((entry) => entry.id !== item.id),
      };
      setData(nextData);
      let cacheError = "";
      try {
        saveDemoData(nextData);
      } catch {
        cacheError = "Deleted from Supabase, but the local menu cache could not be updated.";
      }
      if (cacheError) {
        setFeedback(cacheError);
        return;
      }
      setFeedback(`"${item.name}" was deleted.`);
    } catch (cause) {
      setActionError(
        signal.aborted
          ? "Deleting the menu item timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not delete this product.",
      );
    } finally {
      setProcessingItemId(null);
    }
  }

  async function toggleAvailability(item: DemoMenuItem) {
    setActionError("");
    setFeedback("");
    if (!data) return;
    const isAvailable = !item.isAvailable;
    setProcessingItemId(item.id);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch("/api/menu-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, isAvailable }),
        cache: "no-store",
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not update product availability in Supabase.",
        );
      }
      if (
        !isRecord(payload) ||
        !isRecord(payload.item) ||
        payload.item.id !== item.id ||
        payload.item.isAvailable !== isAvailable
      ) {
        throw new Error("Supabase did not confirm the availability change.");
      }
      const nextData: DemoData = {
        ...data,
        menuItems: data.menuItems.map((entry) =>
          entry.id === item.id ? { ...entry, isAvailable } : entry,
        ),
      };
      setData(nextData);
      let cacheError = "";
      try {
        saveDemoData(nextData);
      } catch {
        cacheError = "Availability saved to Supabase, but the local menu cache could not be updated.";
      }
      if (cacheError) {
        setFeedback(cacheError);
        return;
      }
      setFeedback(`"${item.name}" is now ${isAvailable ? "available" : "unavailable"}.`);
    } catch (cause) {
      setActionError(
        signal.aborted
          ? "Updating menu item availability timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not update item availability.",
      );
    } finally {
      setProcessingItemId(null);
    }
  }

  return (
    <>
      <main className="vr-admin-menu-items-page vr-admin-management-page mx-auto w-full max-w-[1450px] px-4 py-5 sm:px-8 sm:py-7 md:px-10">
          <AdminPageHeading
              description="Manage dishes, categories, pricing, and availability."
            eyebrow="MENU MANAGEMENT"
              title="Menu Items Catalog"
          >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d7e8dc] bg-[#edf5ef] px-3 text-xs font-medium text-[#185c43]">
                  <span className="size-2 rounded-full bg-[#20704d]" />
                  {data && !loadError ? "Sync active" : loading ? "Syncing" : "Sync unavailable"}
                </span>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#f97316] px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(249,115,22,0.16)] transition hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!data || categories.length === 0}
                  onClick={openAddModal}
                  type="button"
                >
                  <Icon name="plus" />
                  Add new dish
                </button>
              </div>
          </AdminPageHeading>

          {(loadError || actionError || feedback) && (
            <div
              aria-live="polite"
              className={`mb-5 rounded-xl border p-4 text-sm ${
                loadError || actionError
                  ? "border-[#f1d8d5] bg-[#fff5f4] text-[#a3423c]"
                  : "border-[#d7e8dc] bg-[#edf5ef] text-[#185c43]"
              }`}
              role={loadError || actionError ? "alert" : "status"}
            >
              {loadError || actionError || feedback}
              {loadError && (
                <button className="ml-3 font-semibold underline" onClick={refreshData} type="button">
                  Try again
                </button>
              )}
            </div>
          )}

          {data && categories.length === 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e7dcc8] bg-[#fbf6ed] p-4 text-sm text-[#705a35]">
              <span>Create a category before adding menu items.</span>
              <Link className="font-semibold underline" href="/admin/categories">Manage categories</Link>
            </div>
          )}

          <div className="mb-5 hidden grid-cols-2 gap-3 md:grid md:grid-cols-4">
            <SummaryCard detail="Menu dishes" label="Total catalog" value={data ? items.length : 0} />
            <SummaryCard detail="Available to order" label="Live" value={data ? availableCount : 0} />
            <SummaryCard detail="Currently paused" label="Paused" value={data ? items.length - availableCount : 0} />
            <SummaryCard detail="Visible categories" label="Categories" value={data ? activeCategoryCount : 0} />
          </div>

          <section
            aria-busy={loading}
            className="overflow-hidden rounded-2xl border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.05)]"
          >
            <div className="border-b border-[#e5e8e2] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">Menu catalog</h2>
                  <p className="mt-1 text-xs text-[#747b75]">
                    {items.length} dishes · {availableCount} available · {filteredItems.length} shown
                  </p>
                </div>
                <label className="relative block w-full sm:max-w-sm">
                  <span className="sr-only">Search menu items</span>
                  <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-[#747b75]">
                    <Icon name="search" />
                  </span>
                  <input
                    className={`${inputClass} pl-10`}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search dish name or category"
                    type="search"
                    value={search}
                  />
                </label>
              </div>
              <div
                aria-label="Quick category filters"
                className="mt-4 flex gap-2 overflow-x-auto pb-1"
                role="group"
              >
                <CategoryFilter
                  active={categoryFilter === "all"}
                  count={items.length}
                  label="All"
                  onClick={() => setCategoryFilter("all")}
                />
                {sortedCategories.map((category) => (
                  <CategoryFilter
                    active={categoryFilter === category.id}
                    count={categoryCounts.get(category.id) ?? 0}
                    key={category.id}
                    label={category.name}
                    onClick={() => setCategoryFilter(category.id)}
                  />
                ))}
              </div>
            </div>

            {!data ? (
              <p className="px-6 py-10 text-center text-sm text-[#747b75]">
                {loading ? "Loading menu items…" : loadError || "Menu data could not be loaded."}
              </p>
            ) : visibleItems.length ? (
              <div>
                <div className="hidden grid-cols-[minmax(0,1.8fr)_minmax(72px,0.7fr)_60px_72px_64px] gap-2 border-b border-[#e5e8e2] bg-[#f8f9f6] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#747b75] md:grid xl:grid-cols-[minmax(0,1.5fr)_110px_85px_96px_82px]">
                  <span>Dish details</span>
                  <span>Category</span>
                  <span>Price</span>
                  <span>Live status</span>
                  <span className="text-center">Actions</span>
                </div>
                <div className="divide-y divide-[#edf0eb]">
                  {visibleItems.map(({ item, category }) => (
                    <MenuItemCard
                      category={category}
                      item={item}
                      key={item.id}
                      onDelete={deleteItem}
                      onEdit={openEditModal}
                      onToggleAvailability={toggleAvailability}
                      busy={processingItemId !== null}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-6 py-14 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#e5f1eb] text-[#185c43]">
                  <Icon name="menu" />
                </span>
                <h3 className="mt-4 text-sm font-semibold">
                  {items.length === 0 ? "No menu items yet" : "No matching menu items"}
                </h3>
                <p className="mt-1 text-sm text-[#747b75]">
                  {items.length === 0
                    ? categories.length
                      ? "Add your first dish to start building the menu."
                      : "Add a category first, then create your first menu item."
                    : "Try another search or category filter."}
                </p>
                {items.length === 0 && categories.length > 0 && (
                  <button
                    className="mt-4 rounded-lg bg-[#185c43] px-4 py-2 text-xs font-semibold text-white hover:bg-[#124b36]"
                    onClick={openAddModal}
                    type="button"
                  >
                    Add your first item
                  </button>
                )}
              </div>
            )}
          </section>
          <p className="mt-5 text-center text-xs text-[#929a93]">
            Menu item changes are saved to Supabase.
          </p>
      </main>

      {isModalOpen && (
        <ItemModal
          categories={sortedCategories}
          editing={editingId !== null}
          error={actionError}
          form={form}
          saving={isSaving || isUploadingImage}
          uploadingImage={isUploadingImage}
          uploadFeedback={feedback}
          onChange={setForm}
          onClose={() => {
            setIsModalOpen(false);
            setActionError("");
          }}
          onUploadImage={uploadMenuItemImage}
          onSave={saveItem}
        />
      )}
    </>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="min-w-0 rounded-xl border border-[#e5e8e2] bg-white p-3 shadow-[0_4px_14px_rgba(26,45,35,0.03)]">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[#747b75]">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-[#929a93]">{detail}</p>
    </article>
  );
}

function MenuItemCard({
  item,
  category,
  busy,
  onDelete,
  onEdit,
  onToggleAvailability,
}: {
  item: DemoMenuItem;
  category: DemoCategory | undefined;
  busy: boolean;
  onDelete: (item: DemoMenuItem) => void;
  onEdit: (item: DemoMenuItem) => void;
  onToggleAvailability: (item: DemoMenuItem) => void;
}) {
  return (
    <article className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2 p-3 transition hover:bg-[#f8f9f6] sm:gap-3 sm:p-4 md:grid-cols-[minmax(0,1.8fr)_minmax(72px,0.7fr)_60px_72px_64px] md:gap-2 md:px-3 md:py-2.5 xl:grid-cols-[minmax(0,1.5fr)_110px_85px_96px_82px]">
      <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
        <ItemImage className="size-16 md:size-12" item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{item.name}</h3>
            <span className="shrink-0 rounded-full bg-[#f8f9f6] px-2 py-0.5 text-[10px] font-medium text-[#747b75] md:hidden">
              {category?.name ?? "Uncategorized"}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-xs leading-4 text-[#747b75] md:line-clamp-2">
            {item.description || "No description"}
          </p>
          <div className="mt-1.5 flex items-center gap-2 md:hidden">
            <strong className="text-sm font-bold tabular-nums">{formatINR.format(item.priceINR)}</strong>
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                item.isAvailable
                  ? "bg-[#e3f3ea] text-[#20704d]"
                  : "bg-[#fff5f4] text-[#a3423c]"
              }`}
            >
              {item.isAvailable ? "Live" : "Paused"}
            </span>
          </div>
        </div>
      </div>
      <div className="hidden min-w-0 md:block">
        <span className="block truncate text-xs text-[#747b75]">{category?.name ?? "Uncategorized"}</span>
        {!category?.isActive && (
          <span className="mt-1 block text-[10px] text-[#a3423c]">Category inactive</span>
        )}
      </div>
      <span className="hidden text-xs font-semibold tabular-nums md:block">
        {formatINR.format(item.priceINR)}
      </span>
      <div className="hidden md:flex">
        <AvailabilityToggle item={item} busy={busy} onToggle={onToggleAvailability} showLabel />
      </div>
      <div className="hidden items-center justify-center gap-1 md:flex">
        <button
          aria-label={`Edit ${item.name}`}
          className="grid size-7 place-items-center rounded-lg text-[#747b75] hover:bg-[#f1f3ef] hover:text-[#185c43] disabled:opacity-50 xl:size-8"
          disabled={busy}
          onClick={() => onEdit(item)}
          type="button"
        >
          <Icon name="edit" />
        </button>
        <button
          aria-label={`Delete ${item.name}`}
          className="grid size-7 place-items-center rounded-lg text-[#a3423c] hover:bg-[#fff5f4] disabled:opacity-50 xl:size-8"
          disabled={busy}
          onClick={() => onDelete(item)}
          type="button"
        >
          <Icon name="delete" />
        </button>
      </div>
      <div className="col-start-3 row-start-1 flex flex-col items-center gap-1 md:hidden">
        <AvailabilityToggle item={item} busy={busy} onToggle={onToggleAvailability} />
        <div className="flex items-center gap-1">
          <button
            aria-label={`Edit ${item.name}`}
            className="grid size-8 place-items-center rounded-lg text-[#747b75] hover:bg-[#f1f3ef] disabled:opacity-50"
            disabled={busy}
            onClick={() => onEdit(item)}
            type="button"
          >
            <Icon name="edit" />
          </button>
          <button
            aria-label={`Delete ${item.name}`}
            className="grid size-8 place-items-center rounded-lg text-[#a3423c] hover:bg-[#fff5f4] disabled:opacity-50"
            disabled={busy}
            onClick={() => onDelete(item)}
            type="button"
          >
            <Icon name="delete" />
          </button>
        </div>
      </div>
    </article>
  );
}

function AvailabilityToggle({
  item,
  busy,
  onToggle,
  showLabel = false,
}: {
  item: DemoMenuItem;
  busy: boolean;
  onToggle: (item: DemoMenuItem) => void;
  showLabel?: boolean;
}) {
  return (
    <button
      aria-label={`${item.isAvailable ? "Pause" : "Make live"} ${item.name}`}
      aria-pressed={item.isAvailable}
      className="inline-flex min-h-8 items-center justify-center gap-2 rounded-full text-[10px] font-semibold text-[#535b55] disabled:opacity-50"
      disabled={busy}
      onClick={() => onToggle(item)}
      type="button"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${item.isAvailable ? "bg-[#20704d]" : "bg-[#b8bdc7]"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${item.isAvailable ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {showLabel && (item.isAvailable ? "Live" : "Paused")}
    </button>
  );
}

function CategoryFilter({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-medium transition ${
        active
          ? "border-[#f97316] bg-[#f97316] text-white"
          : "border-[#e5e8e2] bg-[#f8f9f6] text-[#747b75] hover:border-[#f97316] hover:text-[#185c43]"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
      <span className={active ? "text-white/80" : "text-[#929a93]"}>{count}</span>
    </button>
  );
}

function ItemModal({
  categories,
  editing,
  error,
  form,
  saving,
  uploadingImage,
  uploadFeedback,
  onChange,
  onClose,
  onUploadImage,
  onSave,
}: {
  categories: DemoCategory[];
  editing: boolean;
  error: string;
  form: ItemForm;
  saving: boolean;
  uploadingImage: boolean;
  uploadFeedback: string;
  onChange: (value: ItemForm) => void;
  onClose: () => void;
  onUploadImage: (file: File) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const selectableCategories = categories.filter(
    (category) => category.isActive || category.id === form.categoryId,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#17251d]/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        aria-labelledby="item-modal-title"
        aria-modal="true"
        className="my-auto w-full max-w-lg rounded-2xl border border-[#e5e8e2] bg-white p-6 shadow-xl"
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold" id="item-modal-title">{editing ? "Edit menu item" : "Add menu item"}</h2>
            <p className="mt-1 text-sm text-[#747b75]">Add the details guests see on your menu.</p>
          </div>
          <button
            aria-label="Close dialog"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[#747b75] hover:bg-[#f5f6f2] disabled:opacity-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <form className="space-y-4" onSubmit={onSave}>
          <div>
            <span className="mb-1.5 block text-sm font-medium">Item image</span>
            <div className="flex items-center gap-4">
              <ItemImage item={{ name: form.name, imageUrl: form.imageUrl }} />
              <div className="min-w-0 flex-1">
                <label className="mb-1.5 block text-xs text-[#747b75]" htmlFor="item-image-upload">
                  Upload or replace image (JPEG, PNG, WebP, or AVIF; max 5 MiB)
                </label>
                <input
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="block w-full text-xs text-[#535b55] file:mr-3 file:rounded-lg file:border-0 file:bg-[#e5f1eb] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#185c43] hover:file:bg-[#d7e8dc] disabled:opacity-50"
                  disabled={saving}
                  id="item-image-upload"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onUploadImage(file);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
                {uploadingImage && (
                  <p className="mt-1.5 text-xs text-[#747b75]" role="status">
                    Uploading image…
                  </p>
                )}
                {!uploadingImage && uploadFeedback && (
                  <p className="mt-1.5 text-xs text-[#185c43]" role="status">
                    {uploadFeedback}
                  </p>
                )}
                <label className="mb-1.5 mt-3 block text-xs text-[#747b75]" htmlFor="item-image">
                  Or paste a public image URL
                </label>
                <input
                  className={inputClass}
                  disabled={saving}
                  id="item-image"
                  onChange={(event) => onChange({ ...form, imageUrl: event.target.value })}
                  placeholder="https://example.com/dish.jpg"
                  type="url"
                  value={form.imageUrl}
                />
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="item-name">Name</label>
            <input
              autoFocus
              className={inputClass}
              id="item-name"
              maxLength={100}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="e.g. Garden Herb Pasta"
              required
              value={form.name}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="item-description">Description</label>
            <textarea
              className="w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15"
              id="item-description"
              maxLength={300}
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              placeholder="Describe the dish and its ingredients"
              rows={3}
              value={form.description}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="item-price">Price (INR)</label>
              <input
                className={inputClass}
                id="item-price"
                min="0"
                onChange={(event) => onChange({ ...form, price: event.target.value })}
                required
                step="0.01"
                type="number"
                value={form.price}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="item-category">Category</label>
              <select
                className={inputClass}
                id="item-category"
                onChange={(event) => onChange({ ...form, categoryId: event.target.value })}
                required
                value={form.categoryId}
              >
                <option disabled value="">Select a category</option>
                {selectableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}{category.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-[#535b55]">
            <input
              checked={form.isAvailable}
              className="size-4 accent-[#185c43]"
              onChange={(event) => onChange({ ...form, isAvailable: event.target.checked })}
              type="checkbox"
            />
            Available to order
          </label>
          {error && <p className="text-sm text-[#a3423c]" role="alert">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-[#edf0eb] pt-4">
            <button
              className="h-10 rounded-[10px] border border-[#e5e8e2] px-4 text-sm font-medium text-[#535b55] hover:bg-[#f8f9f6] disabled:opacity-50"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-10 rounded-[10px] bg-[#185c43] px-4 text-sm font-semibold text-white hover:bg-[#124b36] disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              {uploadingImage
                ? "Uploading…"
                : saving
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Add item"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ItemImage({
  item,
  className = "size-[76px] sm:size-[84px]",
}: {
  item: Pick<DemoMenuItem, "name" | "imageUrl">;
  className?: string;
}) {
  return (
    <div
      aria-label={`${item.name || "Menu item"} image`}
      className={`relative grid ${className} shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e5e8e2] bg-gradient-to-br from-[#eef3e8] via-[#f5e9d4] to-[#e1eadc]`}
      role="img"
      style={
        item.imageUrl
          ? {
              backgroundImage: `url("${item.imageUrl}")`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {!item.imageUrl && (
        <>
          <span className="absolute size-12 rounded-full border-[5px] border-white/90 shadow-sm" />
          <span className="absolute size-7 rounded-full bg-[#d9a36c]/80" />
          <span className="absolute -right-1 top-2 size-5 rounded-full bg-[#7b9b67]/80 blur-[1px]" />
          <span className="absolute bottom-2 left-2 size-3 rounded-full bg-[#c9664e]/80" />
        </>
      )}
    </div>
  );
}

function Icon({
  name,
}: {
  name: "menu" | "plus" | "search" | "close" | "edit" | "delete";
}) {
  const paths = {
    menu: <><path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></>,
    delete: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
