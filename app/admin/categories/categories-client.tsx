"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoCategory, DemoData } from "../_lib/demo-data";
import { loadDemoData, saveDemoData } from "../_lib/demo-storage";
import { SignOutButton } from "../_lib/admin-provider";
import { AdminPageHeading } from "../_components/admin-page";
import {
  createTimeoutSignal,
  fetchJsonWithTimeout,
  RequestCancelledError,
  RequestTimeoutError,
} from "../_lib/request-timeout";

type CategoryForm = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
  imageUrl: string;
};

const navigation = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "dashboard" },
  { label: "Menu Categories", href: "/admin/categories", icon: "category", active: true },
  { label: "Menu Items", href: "/admin/menu-items", icon: "menu" },
  { label: "Profile", href: "/admin/profile", icon: "profile" },
] as const;

const blankForm: CategoryForm = {
  name: "",
  description: "",
  sortOrder: "1",
  isActive: true,
  imageUrl: "",
};
const emptyCategories: DemoCategory[] = [];
const emptyItems: DemoData["menuItems"] = [];
const emptyDemoData: DemoData = { categories: [], menuItems: [], tables: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isDemoMenuItem(value: unknown): value is DemoData["menuItems"][number] {
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

export default function AdminCategoriesClient() {
  const [data, setData] = useState<DemoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryForm>(blankForm);
  const [isSaving, setIsSaving] = useState(false);
  const [processingCategoryId, setProcessingCategoryId] = useState<string | null>(null);
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
        { response: categoriesResponse, payload: categoriesPayload },
        { response: itemsResponse, payload: itemsPayload },
      ] = await Promise.all([
        fetchJsonWithTimeout(
          "/api/categories",
          { cache: "no-store", signal: controller.signal },
          15_000,
        ),
        fetchJsonWithTimeout(
          "/api/menu-items",
          { cache: "no-store", signal: controller.signal },
          15_000,
        ),
      ]);
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
            ? "Loading categories timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load categories from Supabase.",
        );
      }
    } finally {
      loadInFlight.current = false;
      if (loadController.current === controller) loadController.current = null;
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshData(), 0);
    const handleRefresh = () => void refreshData();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshData();
    };
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("pageshow", handleRefresh);
    window.addEventListener("virtual-rudra:refresh", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("pageshow", handleRefresh);
      window.removeEventListener("virtual-rudra:refresh", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
      loadController.current?.abort();
    };
  }, []);

  const categories = data?.categories ?? emptyCategories;
  const items = data?.menuItems ?? emptyItems;
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return categories
      .filter(
        (category) =>
          category.name.toLowerCase().includes(query) ||
          category.description.toLowerCase().includes(query),
      )
      .toSorted((left, right) => left.sortOrder - right.sortOrder);
  }, [categories, search]);

  function openAddModal() {
    setEditingId(null);
    setForm({ ...blankForm, sortOrder: String(categories.length + 1) });
    setSaveError("");
    setFeedback("");
    setIsModalOpen(true);
  }

  function openEditModal(category: DemoCategory) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      description: category.description,
      sortOrder: String(category.sortOrder),
      isActive: category.isActive,
      imageUrl: category.imageUrl,
    });
    setSaveError("");
    setFeedback("");
    setIsModalOpen(true);
  }

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    setFeedback("");
    if (!data) {
      setSaveError("Demo data is not available. Reload the page and try again.");
      return;
    }

    const name = form.name.trim();
    const description = form.description.trim();
    const parsedOrder = Number(form.sortOrder);
    if (!name) {
      setSaveError("Enter a category name.");
      return;
    }
    if (name.length > 80) {
      setSaveError("Category names must be 80 characters or fewer.");
      return;
    }
    if (categories.some((category) =>
      category.id !== editingId && category.name.toLowerCase() === name.toLowerCase(),
    )) {
      setSaveError("A category with this name already exists.");
      return;
    }
    if (description.length > 180) {
      setSaveError("Descriptions must be 180 characters or fewer.");
      return;
    }
    if (!Number.isInteger(parsedOrder) || parsedOrder < 1) {
      setSaveError("Sort order must be a whole number greater than zero.");
      return;
    }
    if (form.imageUrl.trim()) {
      try {
        const image = new URL(form.imageUrl.trim());
        if (image.protocol !== "https:" && image.protocol !== "http:") {
          throw new Error("invalid protocol");
        }
      } catch {
        setSaveError("Enter a valid http or https image URL, or leave it blank.");
        return;
      }
    }

    const existing = categories.find((category) => category.id === editingId);
    setIsSaving(true);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch("/api/categories", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(existing ? { categoryId: existing.id } : {}),
          name,
          description,
          imageUrl: form.imageUrl.trim(),
          sortOrder: parsedOrder,
          isActive: form.isActive,
        }),
        cache: "no-store",
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not save the category to Supabase.",
        );
      }
      if (!isRecord(payload) || !isDemoCategory(payload.category)) {
        throw new Error("Supabase did not return the saved category.");
      }
      const savedCategory = payload.category;
      const nextData: DemoData = {
        ...data,
        categories: existing
          ? data.categories.map((category) =>
              category.id === existing.id ? savedCategory : category,
            )
          : [...data.categories, savedCategory],
      };
      setData(nextData);
      let cacheError = "";
      try {
        saveDemoData(nextData);
      } catch {
        cacheError = "Saved to Supabase, but the local menu cache could not be updated.";
      }
      setIsModalOpen(false);
      setFeedback(cacheError || (existing ? `"${name}" was updated.` : `"${name}" was added.`));
    } catch (cause) {
      setSaveError(
        signal.aborted
          ? "Saving the category timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not save this category to Supabase.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCategory(category: DemoCategory) {
    setSaveError("");
    setFeedback("");
    if (!data) return;
    if (!window.confirm(`Delete the "${category.name}" category? This cannot be undone.`)) {
      return;
    }

    setProcessingCategoryId(category.id);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch(
        `/api/categories?id=${encodeURIComponent(category.id)}`,
        { method: "DELETE", cache: "no-store", signal },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not delete the category from Supabase.",
        );
      }
      const nextData: DemoData = {
        ...data,
        categories: data.categories.filter((entry) => entry.id !== category.id),
      };
      setData(nextData);
      let cacheError = "";
      try {
        saveDemoData(nextData);
      } catch {
        cacheError = "Deleted from Supabase, but the local menu cache could not be updated.";
      }
      setFeedback(cacheError || `"${category.name}" was deleted.`);
    } catch (cause) {
      setSaveError(
        signal.aborted
          ? "Deleting the category timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not delete this category from Supabase.",
      );
    } finally {
      setProcessingCategoryId(null);
    }
  }

  async function toggleActive(category: DemoCategory) {
    setSaveError("");
    setFeedback("");
    if (!data) return;
    const isActive = !category.isActive;
    setProcessingCategoryId(category.id);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: category.id,
          name: category.name,
          description: category.description,
          imageUrl: category.imageUrl,
          sortOrder: category.sortOrder,
          isActive,
        }),
        cache: "no-store",
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not update category status in Supabase.",
        );
      }
      if (!isRecord(payload) || !isDemoCategory(payload.category)) {
        throw new Error("Supabase did not confirm the category status change.");
      }
      const savedCategory = payload.category;
      const nextData: DemoData = {
        ...data,
        categories: data.categories.map((entry) =>
          entry.id === category.id ? savedCategory : entry,
        ),
      };
      setData(nextData);
      let cacheError = "";
      try {
        saveDemoData(nextData);
      } catch {
        cacheError = "Status saved to Supabase, but the local menu cache could not be updated.";
      }
      setFeedback(cacheError || `"${category.name}" is now ${isActive ? "active" : "inactive"}.`);
    } catch (cause) {
      setSaveError(
        signal.aborted
          ? "Updating category status timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not update category status in Supabase.",
      );
    } finally {
      setProcessingCategoryId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6f2] text-[#202521] md:flex">
      <aside className="hidden w-[248px] shrink-0 border-r border-[#e5e8e2] bg-white px-4 py-6 md:flex md:flex-col">
        <Brand />
        <p className="mb-3 mt-10 px-3 text-[10px] font-bold tracking-[0.16em] text-[#929a93]">
          WORKSPACE
        </p>
        <nav aria-label="Admin navigation" className="space-y-1">
          {navigation.map((item) => <NavigationLink key={item.label} {...item} />)}
        </nav>
        <AdminIdentity />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-[#e5e8e2] bg-white px-5 py-4 sm:px-8 md:px-10">
          <div className="flex items-center justify-between gap-3">
            <div className="md:hidden"><Brand /></div>
            <p className="hidden text-sm font-medium text-[#535b55] md:block">Menu management</p>
            <SignOutButton />
          </div>
          <nav aria-label="Admin navigation" className="mt-4 flex gap-2 overflow-x-auto md:hidden">
            {navigation.map((item) => <NavigationLink key={item.label} {...item} mobile />)}
          </nav>
        </header>

        <main className="vr-admin-management-page mx-auto w-full max-w-[1450px] px-5 py-7 sm:px-8 sm:py-9 md:px-10">
          <AdminPageHeading
            description="Organize the menu and control which categories are visible."
            eyebrow="MENU MANAGEMENT"
            title="Menu categories"
          >
            <button
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185c43] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#124b36] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!data || isSaving || processingCategoryId !== null}
              onClick={openAddModal}
              type="button"
            >
              <Icon name="plus" />
              Add category
            </button>
          </AdminPageHeading>

          {(loadError || saveError || feedback) && (
            <div
              aria-live="polite"
              className={`mb-5 rounded-xl border p-4 text-sm ${
                loadError || saveError
                  ? "border-[#f1d8d5] bg-[#fff5f4] text-[#a3423c]"
                  : "border-[#d7e8dc] bg-[#edf5ef] text-[#185c43]"
              }`}
              role={loadError || saveError ? "alert" : "status"}
            >
              {loadError || saveError || feedback}
              {loadError && (
                <button
                  className="ml-3 font-semibold underline"
                  disabled={loading}
                  onClick={() => void refreshData()}
                  type="button"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <section
            aria-busy={loading}
            className="overflow-hidden rounded-[14px] border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.04)]"
          >
            <div className="flex flex-col gap-4 border-b border-[#e5e8e2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="font-bold">All categories</h2>
                <p className="mt-1 text-xs text-[#747b75]">
                  {categories.length} categories · {categories.filter((category) => category.isActive).length} active
                </p>
              </div>
              <label className="relative block w-full sm:max-w-xs">
                <span className="sr-only">Search categories</span>
                <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-[#747b75]">
                  <Icon name="search" />
                </span>
                <input
                  className="h-10 w-full rounded-[10px] border border-[#e5e8e2] bg-white pl-10 pr-3 text-sm outline-none transition placeholder:text-[#929a93] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search categories"
                  type="search"
                  value={search}
                />
              </label>
            </div>

            {!data ? (
              <p className="px-6 py-10 text-center text-sm text-[#747b75]">
                {loading
                  ? "Loading categories…"
                  : loadError || "Category data could not be loaded."}
              </p>
            ) : filteredCategories.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[690px] text-left text-sm">
                  <thead className="bg-[#f8f9f6] text-[10px] font-semibold uppercase tracking-wide text-[#747b75]">
                    <tr>
                      <th className="px-5 py-3 font-semibold sm:px-6">Category</th>
                      <th className="px-4 py-3 font-semibold">Menu items</th>
                      <th className="px-4 py-3 font-semibold">Order</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold sm:px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf0eb]">
                    {filteredCategories.map((category) => {
                      const count = categoryCounts.get(category.id) ?? 0;
                      return (
                        <tr className="align-top hover:bg-[#fbfcfa]" key={category.id}>
                          <td className="px-5 py-4 sm:px-6">
                            <div className="flex items-start gap-3">
                              <CategoryImage category={category} />
                              <div className="min-w-0">
                                <p className="font-semibold">{category.name}</p>
                                <p className="mt-1 max-w-md text-xs leading-5 text-[#747b75]">
                                  {category.description || "No description"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-[#747b75]">
                            {count} {count === 1 ? "item" : "items"}
                          </td>
                          <td className="px-4 py-4 text-[#535b55]">{category.sortOrder}</td>
                          <td className="px-4 py-4">
                            <button
                              aria-label={`${category.isActive ? "Deactivate" : "Activate"} ${category.name}`}
                              aria-pressed={category.isActive}
                              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                category.isActive
                                  ? "bg-[#e3f3ea] text-[#20704d]"
                                  : "bg-[#edf0ed] text-[#68716a]"
                              }`}
                              disabled={processingCategoryId !== null}
                              onClick={() => toggleActive(category)}
                              type="button"
                            >
                              {category.isActive ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="px-5 py-4 sm:px-6">
                            <div className="flex justify-end gap-2">
                              <button
                                className="rounded-lg border border-[#e5e8e2] px-3 py-1.5 text-xs font-medium text-[#535b55] hover:border-[#185c43] hover:text-[#185c43]"
                                disabled={processingCategoryId !== null || isSaving}
                                onClick={() => openEditModal(category)}
                                type="button"
                              >
                                Edit
                              </button>
                              <button
                                className="rounded-lg border border-[#f1d8d5] px-3 py-1.5 text-xs font-medium text-[#a3423c] hover:bg-[#fff5f4]"
                                disabled={processingCategoryId !== null || isSaving}
                                onClick={() => deleteCategory(category)}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-14 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#e5f1eb] text-[#185c43]">
                  <Icon name="category" />
                </span>
                <h3 className="mt-4 text-sm font-semibold">
                  {search ? "No matching categories" : "No categories yet"}
                </h3>
                <p className="mt-1 text-sm text-[#747b75]">
                  {search
                    ? "Try a different search term."
                    : "Add a category to start organizing your restaurant menu."}
                </p>
                {!search && (
                  <button
                    className="mt-4 rounded-lg bg-[#185c43] px-4 py-2 text-xs font-semibold text-white hover:bg-[#124b36]"
                    onClick={openAddModal}
                    type="button"
                  >
                    Add your first category
                  </button>
                )}
              </div>
            )}
          </section>
          <p className="mt-5 text-center text-xs text-[#929a93]">
            Category changes are saved to Supabase.
          </p>
        </main>
      </div>

      {isModalOpen && (
        <CategoryModal
          editing={editingId !== null}
          form={form}
          error={saveError}
          saving={isSaving}
          onClose={() => {
            setIsModalOpen(false);
            setSaveError("");
          }}
          onChange={setForm}
          onSave={saveCategory}
        />
      )}
    </div>
  );
}

function CategoryModal({
  editing,
  form,
  error,
  saving,
  onClose,
  onChange,
  onSave,
}: {
  editing: boolean;
  form: CategoryForm;
  error: string;
  saving: boolean;
  onClose: () => void;
  onChange: (value: CategoryForm) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const inputClass =
    "h-11 w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 text-sm outline-none focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#17251d]/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="category-modal-title"
        aria-modal="true"
        className="my-auto w-full max-w-lg rounded-2xl border border-[#e5e8e2] bg-white p-6 shadow-xl"
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold" id="category-modal-title">
              {editing ? "Edit category" : "Add category"}
            </h2>
            <p className="mt-1 text-sm text-[#747b75]">
              Set the category details guests see on your menu.
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[#747b75] hover:bg-[#f5f6f2]"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <form className="space-y-4" onSubmit={onSave}>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="category-name">
              Name
            </label>
            <input
              autoFocus
              className={inputClass}
              id="category-name"
              maxLength={80}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="e.g. Tandoor Specials"
              required
              value={form.name}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="category-description">
              Description
            </label>
            <textarea
              className="w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15"
              id="category-description"
              maxLength={180}
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              placeholder="Briefly describe this part of your menu"
              rows={3}
              value={form.description}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="category-image">
              Image URL <span className="font-normal text-[#929a93]">(optional)</span>
            </label>
            <input
              className={inputClass}
              id="category-image"
              onChange={(event) => onChange({ ...form, imageUrl: event.target.value })}
              placeholder="https://example.com/category.jpg"
              type="url"
              value={form.imageUrl}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="category-order">
                Sort order
              </label>
              <input
                className={inputClass}
                id="category-order"
                min="1"
                onChange={(event) => onChange({ ...form, sortOrder: event.target.value })}
                required
                step="1"
                type="number"
                value={form.sortOrder}
              />
            </div>
            <label className="flex items-center gap-2.5 self-end pb-3 text-sm text-[#535b55]">
              <input
                checked={form.isActive}
                className="size-4 accent-[#185c43]"
                onChange={(event) => onChange({ ...form, isActive: event.target.checked })}
                type="checkbox"
              />
              Active category
            </label>
          </div>
          {error && <p className="text-sm text-[#a3423c]" role="alert">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-[#edf0eb] pt-4">
            <button
              className="h-10 rounded-[10px] border border-[#e5e8e2] px-4 text-sm font-medium text-[#535b55] hover:bg-[#f8f9f6]"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-10 rounded-[10px] bg-[#185c43] px-4 text-sm font-semibold text-white hover:bg-[#124b36]"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Add category"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CategoryImage({ category }: { category: DemoCategory }) {
  return (
    <span
      aria-label={`${category.name} image`}
      className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[#eef3e8] to-[#f5e9d4] text-[#185c43]"
      role="img"
      style={
        category.imageUrl
          ? {
              backgroundImage: `url("${category.imageUrl}")`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {!category.imageUrl && <Icon name="category" />}
    </span>
  );
}

function Brand() {
  return (
    <Link className="flex items-center gap-3 font-bold text-[#202521]" href="/admin/dashboard">
      <span className="grid size-9 place-items-center rounded-xl bg-[#185c43] text-white">
        <Icon name="restaurant" />
      </span>
      <span>Virtual Rudra</span>
    </Link>
  );
}

function AdminIdentity() {
  return (
    <div className="mt-auto border-t border-[#e5e8e2] pt-5">
      <div className="flex items-center gap-3 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-[#e5f1eb] text-xs font-bold text-[#185c43]">VR</span>
        <span>
          <span className="block text-sm font-semibold">Virtual Rudra</span>
          <span className="block text-xs text-[#747b75]">Restaurant admin · demo</span>
        </span>
      </div>
    </div>
  );
}

function NavigationLink({
  label,
  href,
  icon,
  active = false,
  mobile = false,
}: {
  label: string;
  href: string;
  icon: "dashboard" | "category" | "menu" | "profile";
  active?: boolean;
  mobile?: boolean;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-3 rounded-[10px] px-3 font-medium transition ${
        mobile ? "py-2 text-xs" : "py-3 text-sm"
      } ${
        active
          ? "bg-[#e5f1eb] text-[#185c43]"
          : "text-[#747b75] hover:bg-[#f8f9f6] hover:text-[#202521]"
      }`}
      href={href}
    >
      <Icon name={icon} />
      {label}
    </Link>
  );
}

function Icon({
  name,
}: {
  name: "dashboard" | "category" | "menu" | "profile" | "restaurant" | "plus" | "search" | "close";
}) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    category: <><path d="M20 13 13 20a2 2 0 0 1-3 0l-6-6a2 2 0 0 1 0-3l7-7h7a2 2 0 0 1 2 2Z" /><circle cx="15.5" cy="8.5" r="1" /></>,
    menu: <><path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    restaurant: <><path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
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
