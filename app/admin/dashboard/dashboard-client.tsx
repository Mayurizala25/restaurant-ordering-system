"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAdmin } from "../_lib/admin-provider";
import { AdminPageHeading } from "../_components/admin-page";
import {
  createTimeoutSignal,
  fetchJsonWithTimeout,
  RequestCancelledError,
  RequestTimeoutError,
} from "../_lib/request-timeout";

const formatINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const formatUpdatedTime = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const updatableOrderStatuses = [
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;
type UpdatableOrderStatus = (typeof updatableOrderStatuses)[number];

type AdminOrderItem = {
  id: string;
  item_name: string;
  quantity: number;
};

type AdminOrderTable = {
  table_number: number;
};

type AdminOrder = {
  id: string;
  status: string;
  total_inr: number | string;
  tax_rate_percent: number | string;
  tax_amount_inr: number | string;
  created_at: string;
  restaurant_tables: AdminOrderTable | AdminOrderTable[] | null;
  restaurant_order_items: AdminOrderItem[];
};

type DashboardCategory = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
};

type DashboardMenuItem = {
  id: string;
  name: string;
  description: string;
  priceINR: number;
  imageUrl: string;
  categoryId: string;
  isAvailable: boolean;
  sortOrder: number;
};

type DashboardData = {
  categories: DashboardCategory[];
  menuItems: DashboardMenuItem[];
};

type DashboardMetrics = {
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  completedOrders: number;
  revenueINR: number;
};

const RESTAURANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardCategory(value: unknown): value is DashboardCategory {
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

function isDashboardMenuItem(value: unknown): value is DashboardMenuItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.priceINR === "number" &&
    Number.isFinite(value.priceINR) &&
    typeof value.imageUrl === "string" &&
    typeof value.categoryId === "string" &&
    typeof value.isAvailable === "boolean" &&
    typeof value.sortOrder === "number"
  );
}

function isDashboardMetrics(value: unknown): value is DashboardMetrics {
  return (
    isRecord(value) &&
    typeof value.totalOrders === "number" &&
    Number.isSafeInteger(value.totalOrders) &&
    value.totalOrders >= 0 &&
    typeof value.todayOrders === "number" &&
    Number.isSafeInteger(value.todayOrders) &&
    value.todayOrders >= 0 &&
    typeof value.pendingOrders === "number" &&
    Number.isSafeInteger(value.pendingOrders) &&
    value.pendingOrders >= 0 &&
    typeof value.completedOrders === "number" &&
    Number.isSafeInteger(value.completedOrders) &&
    value.completedOrders >= 0 &&
    typeof value.revenueINR === "number" &&
    Number.isFinite(value.revenueINR) &&
    value.revenueINR >= 0
  );
}

function isAdminOrderItem(value: unknown): value is AdminOrderItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.item_name === "string" &&
    typeof value.quantity === "number"
  );
}

function isAdminOrder(value: unknown): value is AdminOrder {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    (typeof value.total_inr !== "number" && typeof value.total_inr !== "string") ||
    !Number.isFinite(Number(value.total_inr)) ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.restaurant_order_items) ||
    !value.restaurant_order_items.every(isAdminOrderItem)
  ) {
    return false;
  }

  const tables = value.restaurant_tables;
  return (
    tables === null ||
    (isRecord(tables) && typeof tables.table_number === "number") ||
    (Array.isArray(tables) &&
      tables.every(
        (table) => isRecord(table) && typeof table.table_number === "number",
      ))
  );
}

export function AdminDashboardClient() {
  const { syncNotifications } = useAdmin();
  const [data, setData] = useState<DashboardData | null>(null);
  const [dataError, setDataError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersLastUpdated, setOrdersLastUpdated] = useState<Date | null>(null);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [orderStatusErrors, setOrderStatusErrors] = useState<Record<string, string>>({});
  const orderFetchInFlight = useRef(false);
  const dataFetchInFlight = useRef(false);
  const metricsFetchInFlight = useRef(false);
  const loadControllers = useRef(new Set<AbortController>());
  const orderStatusRevision = useRef(0);
  const lastScrolledOrder = useRef("");
  const orderStatusOverrides = useRef(
    new Map<string, { status: string; revision: number }>(),
  );

  const refreshData = useCallback(async () => {
    if (dataFetchInFlight.current) return;
    dataFetchInFlight.current = true;
    setRefreshing(true);
    setDataError("");
    const controller = new AbortController();
    loadControllers.current.add(controller);
    try {
      const [
        { response: categoriesResponse, payload: categoriesPayload },
        { response: itemsResponse, payload: itemsPayload },
      ] = await Promise.all([
        fetchJsonWithTimeout("/api/categories",         { cache: "no-store", signal: controller.signal }, 15_000),
        fetchJsonWithTimeout("/api/menu-items",         { cache: "no-store", signal: controller.signal }, 15_000),
      ]);

      if (!categoriesResponse.ok) {
        const message =
          isRecord(categoriesPayload) && typeof categoriesPayload.error === "string"
            ? categoriesPayload.error
            : "Could not load categories.";
        throw new Error(message);
      }
      if (!itemsResponse.ok) {
        const message =
          isRecord(itemsPayload) && typeof itemsPayload.error === "string"
            ? itemsPayload.error
            : "Could not load menu items.";
        throw new Error(message);
      }
      if (
        !isRecord(categoriesPayload) ||
        !Array.isArray(categoriesPayload.categories) ||
        !categoriesPayload.categories.every(isDashboardCategory) ||
        !isRecord(itemsPayload) ||
        !Array.isArray(itemsPayload.items) ||
        !itemsPayload.items.every(isDashboardMenuItem)
      ) {
        throw new Error("Restaurant menu data could not be read.");
      }
      setData({
        categories: categoriesPayload.categories,
        menuItems: itemsPayload.items,
      });
    } catch (cause) {
      if (!(cause instanceof RequestCancelledError)) {
        setDataError(
          cause instanceof RequestTimeoutError
            ? "Loading restaurant menu data timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load restaurant menu data.",
        );
      }
    } finally {
      loadControllers.current.delete(controller);
      dataFetchInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    if (metricsFetchInFlight.current) return;
    metricsFetchInFlight.current = true;
    setMetricsLoading(true);
    setMetricsError("");
    const controller = new AbortController();
    loadControllers.current.add(controller);
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/dashboard-stats",
        { cache: "no-store", signal: controller.signal },
        20_000,
      );
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not load dashboard statistics.";
        throw new Error(message);
      }
      if (!isDashboardMetrics(payload)) {
        throw new Error("Dashboard statistics could not be read.");
      }
      setMetrics(payload);
    } catch (cause) {
      if (!(cause instanceof RequestCancelledError)) {
        setMetricsError(
          cause instanceof RequestTimeoutError
            ? "Loading dashboard statistics timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load dashboard statistics.",
        );
      }
    } finally {
      loadControllers.current.delete(controller);
      metricsFetchInFlight.current = false;
      setMetricsLoading(false);
    }
  }, []);

  const refreshOrders = useCallback(async () => {
    if (orderFetchInFlight.current) return;
    orderFetchInFlight.current = true;
    const revisionAtStart = orderStatusRevision.current;
    setOrdersLoading(true);
    setOrdersError("");
    const controller = new AbortController();
    loadControllers.current.add(controller);
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        "/api/orders",
        { cache: "no-store", signal: controller.signal },
        15_000,
      );

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not load orders.";
        throw new Error(message);
      }
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.orders) ||
        !payload.orders.every(isAdminOrder) ||
        typeof payload.restaurantId !== "string" ||
        !RESTAURANT_ID_PATTERN.test(payload.restaurantId)
      ) {
        throw new Error("Order data could not be read.");
      }
      syncNotifications(payload.restaurantId, payload.orders);
      const refreshedOrders = payload.orders.map((order) => {
        const override = orderStatusOverrides.current.get(order.id);
        if (!override) return order;
        if (override.revision > revisionAtStart) {
          return { ...order, status: override.status };
        }
        orderStatusOverrides.current.delete(order.id);
        return order;
      });
      setOrders(refreshedOrders);
      setOrdersLastUpdated(new Date());
    } catch (cause) {
      if (!(cause instanceof RequestCancelledError)) {
        setOrdersError(
          cause instanceof RequestTimeoutError
            ? "Loading orders timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load orders.",
        );
      }
    } finally {
      loadControllers.current.delete(controller);
      orderFetchInFlight.current = false;
      setOrdersLoading(false);
    }
  }, [syncNotifications]);

  const updateOrderStatus = useCallback(
    async (orderId: string, status: UpdatableOrderStatus) => {
      setUpdatingOrderId(orderId);
      setOrderStatusErrors((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });

      const signal = createTimeoutSignal(20_000);
      try {
        const response = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, status }),
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
              : "Could not update the order status.";
          throw new Error(message);
        }
        if (
          !isRecord(payload) ||
          !isRecord(payload.order) ||
          payload.order.id !== orderId ||
          payload.order.status !== status
        ) {
          throw new Error("Order status could not be confirmed.");
        }

        const revision = ++orderStatusRevision.current;
        orderStatusOverrides.current.set(orderId, { status, revision });
        setOrders((current) =>
          current?.map((order) =>
            order.id === orderId ? { ...order, status } : order,
          ) ?? null,
        );
        void refreshMetrics();
      } catch (cause) {
        setOrderStatusErrors((current) => ({
          ...current,
          [orderId]: signal.aborted
            ? "Updating the order status timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not update the order status.",
        }));
      } finally {
        setUpdatingOrderId(null);
      }
    },
    [refreshMetrics],
  );

  useEffect(() => {
    const controllers = loadControllers.current;
    void refreshData();
    const refreshDashboard = () => {
      void refreshData();
      void refreshMetrics();
      void refreshOrders();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshDashboard();
    };

    window.addEventListener("focus", refreshDashboard);
    window.addEventListener("pageshow", refreshDashboard);
    window.addEventListener("virtual-rudra:refresh", refreshDashboard);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", refreshDashboard);
      window.removeEventListener("pageshow", refreshDashboard);
      window.removeEventListener("virtual-rudra:refresh", refreshDashboard);
      document.removeEventListener("visibilitychange", handleVisibility);
      for (const controller of controllers) controller.abort();
    };
  }, [refreshData, refreshMetrics, refreshOrders]);

  useEffect(() => {
    void refreshMetrics();
    const statsRefreshInterval = window.setInterval(() => {
      void refreshMetrics();
    }, 60_000);
    return () => window.clearInterval(statsRefreshInterval);
  }, [refreshMetrics]);

  useEffect(() => {
    const initialOrdersRefresh = window.setTimeout(() => {
      void refreshOrders();
    }, 0);
    const ordersRefreshInterval = window.setInterval(() => {
      void refreshOrders();
    }, 15_000);
    return () => {
      window.clearTimeout(initialOrdersRefresh);
      window.clearInterval(ordersRefreshInterval);
    };
  }, [refreshOrders]);

  useEffect(() => {
    if (!orders) return;
    const targetId = window.location.hash.slice(1);
    if (!targetId.startsWith("order-") || targetId === lastScrolledOrder.current) {
      return;
    }

    const orderId = targetId.slice("order-".length);
    if (!orders.some((order) => order.id === orderId)) return;
    if (!showAllOrders) {
      setShowAllOrders(true);
      return;
    }
    const target = document.getElementById(targetId);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    lastScrolledOrder.current = targetId;
  }, [orders, showAllOrders]);

  const categories = data?.categories ?? [];
  const items = data?.menuItems ?? [];
  const itemCountByCategory = new Map<string, number>();
  for (const item of items) {
    itemCountByCategory.set(
      item.categoryId,
      (itemCountByCategory.get(item.categoryId) ?? 0) + 1,
    );
  }
  const menuHighlights = items.slice(0, 5);
  const visibleCategories = categories
    .toSorted((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, 5);
  const visibleOrders = showAllOrders ? orders ?? [] : (orders ?? []).slice(0, 5);
  const recentOrderStatuses = [
    { label: "Pending", statuses: ["pending"], color: "#d9922e" },
    {
      label: "In progress",
      statuses: ["accepted", "preparing", "ready"],
      color: "#f97316",
    },
    { label: "Served", statuses: ["served"], color: "#29996a" },
    { label: "Cancelled", statuses: ["cancelled"], color: "#cb6157" },
  ].map((group) => ({
    ...group,
    count:
      orders?.filter((order) => group.statuses.includes(order.status)).length ??
      0,
  }));
  const recentOrderCount = orders?.length ?? 0;
  const summary = [
    {
      label: "Total orders",
      value: metrics?.totalOrders.toLocaleString("en-IN") ?? null,
      detail: metricsLoading
        ? "Loading order totals…"
        : metricsError
          ? "Could not load order totals."
          : metrics?.totalOrders === 0
            ? "No orders received yet"
            : "All-time restaurant orders",
      icon: "orders",
      tone: "bg-[#f7eddc] text-[#9a6a22]",
    },
    {
      label: "Pending orders",
      value: metrics?.pendingOrders.toLocaleString("en-IN") ?? null,
      detail: metricsLoading
        ? "Loading order totals…"
        : metricsError
          ? "Could not load order totals."
          : metrics?.pendingOrders === 0
            ? "No pending orders"
            : "Awaiting confirmation",
      icon: "clock",
      tone: "bg-[#f7eddc] text-[#9a6a22]",
    },
    {
      label: "Revenue",
      value: metrics ? formatINR.format(metrics.revenueINR) : null,
      detail: metricsLoading
        ? "Loading order totals…"
        : metricsError
          ? "Could not load order totals."
          : "Excludes cancelled orders",
      icon: "revenue",
      tone: "bg-[#e5f1eb] text-[#185c43]",
    },
    {
      label: "Today's orders",
      value: metrics?.todayOrders.toLocaleString("en-IN") ?? null,
      detail: metricsLoading
        ? "Loading order totals…"
        : metricsError
          ? "Could not load order totals."
          : "Placed today (IST)",
      icon: "orders",
      tone: "bg-[#e5f1eb] text-[#185c43]",
    },
    {
      label: "Completed orders",
      value: metrics?.completedOrders.toLocaleString("en-IN") ?? null,
      detail: metricsLoading
        ? "Loading order totals…"
        : metricsError
          ? "Could not load order totals."
          : "Served orders",
      icon: "check",
      tone: "bg-[#e5f1eb] text-[#23704f]",
    },
  ] as const;

  return (
    <div className="vr-dashboard-page">
      <main className="vr-admin-management-page vr-dashboard-main mx-auto w-full max-w-[1450px] px-4 py-4 sm:px-8 sm:py-7 md:px-10 md:py-8">
          <AdminPageHeading
            description="Restaurant performance, menu health, and recent orders."
            eyebrow="YOUR RESTAURANT"
            title="Dashboard overview"
          />

          {dataError && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f1d8d5] bg-[#fff5f4] p-4 text-sm text-[#a3423c]" role="alert">
              <span>{dataError}</span>
              <button className="font-semibold underline" onClick={() => void refreshData()} type="button">
                Try again
              </button>
            </div>
          )}

          {metricsError && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f1d8d5] bg-[#fff5f4] p-4 text-sm text-[#a3423c]" role="alert">
              <span>{metricsError}</span>
              <button className="font-semibold underline" onClick={() => void refreshMetrics()} type="button">
                Try again
              </button>
            </div>
          )}

          <section aria-label="Restaurant performance" className="vr-dashboard-stats mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summary.map((card) => (
              <article
                className="vr-dashboard-stat-card rounded-[14px] border border-[#e5e8e2] bg-white p-5 shadow-[0_8px_24px_rgba(26,45,35,0.04)]"
                key={card.label}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#747b75]">{card.label}</p>
                  <span className={`grid size-10 place-items-center rounded-xl ${card.tone}`}>
                    <Icon name={card.icon} />
                  </span>
                </div>
                <p className="mt-4 text-2xl font-bold tracking-tight">
                  {card.value ?? "—"}
                </p>
                <p className="mt-1 text-xs text-[#747b75]">
                  {card.detail}
                </p>
              </article>
            ))}
          </section>

          <section aria-label="Dashboard shortcuts" className="vr-dashboard-shortcuts">
            <QuickAction
              href="/admin/categories"
              icon="category"
              title="Categories"
            />
            <QuickAction
              href="/admin/menu-items"
              icon="menu"
              title="Menu items"
            />
            <QuickAction
              href="/admin/orders"
              icon="orders"
              title="Order management"
            />
            <QuickAction
              href="/admin/analytics"
              icon="analytics"
              title="Analytics"
            />
          </section>

          <TaxSettingsCard />

          <section aria-labelledby="recent-orders-heading" className="vr-dashboard-orders mb-6 overflow-hidden rounded-[14px] border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.04)]">
            <div className="flex items-center justify-between border-b border-[#e5e8e2] px-5 py-4 sm:px-6">
              <div>
                <h2 className="font-bold" id="recent-orders-heading">Recent orders</h2>
                <p className="mt-1 text-xs text-[#747b75]">Latest orders received</p>
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                {orders && orders.length > 0 && (
                  <span className="text-xs text-[#747b75]">
                    {orders.length > 5
                      ? `Showing ${visibleOrders.length} of ${orders.length}`
                      : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
                  </span>
                )}
                {ordersLastUpdated && (
                  <time
                    className="text-[10px] text-[#747b75]"
                    dateTime={ordersLastUpdated.toISOString()}
                  >
                    Updated {formatUpdatedTime.format(ordersLastUpdated)}
                  </time>
                )}
              </div>
            </div>
            {ordersLoading && orders === null ? (
              <p className="px-6 py-8 text-sm text-[#747b75]" role="status">
                Loading orders…
              </p>
            ) : ordersError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6 sm:px-6" role="alert">
                <p className="text-sm text-[#a3423c]">{ordersError}</p>
                <button
                  className="text-xs font-semibold text-[#185c43] hover:underline"
                  onClick={() => void refreshOrders()}
                  type="button"
                >
                  Try again
                </button>
              </div>
            ) : orders?.length === 0 ? (
              <p className="px-6 py-8 text-sm text-[#747b75]">
                No orders have been received yet.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-[#edf0eb]">
                  {visibleOrders.map((order) => (
                    <OrderRow
                      isUpdating={updatingOrderId === order.id}
                      key={order.id}
                      onStatusChange={(status) => {
                        void updateOrderStatus(order.id, status);
                      }}
                      order={order}
                      statusError={orderStatusErrors[order.id]}
                      updatesDisabled={updatingOrderId !== null}
                    />
                  ))}
                </ul>
                {orders && orders.length > 5 && (
                  <div className="vr-dashboard-orders-more">
                    <button
                      aria-expanded={showAllOrders}
                      onClick={() => setShowAllOrders((show) => !show)}
                      type="button"
                    >
                      {showAllOrders ? "Show latest 5 orders" : `Show all ${orders.length} orders`}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <div className="vr-dashboard-secondary grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)]">
            <section className="overflow-hidden rounded-[14px] border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.04)]">
              <div className="flex items-center justify-between border-b border-[#e5e8e2] px-5 py-4 sm:px-6">
                <div>
                  <h2 className="font-bold">Category breakdown</h2>
                  <p className="mt-1 text-xs text-[#747b75]">Menu items in each category</p>
                </div>
                <Link className="text-xs font-semibold text-[#185c43] hover:text-[#124b36]" href="/admin/categories">
                  View all
                </Link>
              </div>
              {refreshing && !data ? (
                <p className="px-6 py-8 text-sm text-[#747b75]" role="status">Loading categories…</p>
              ) : dataError && !data ? (
                <div className="px-6 py-8 text-sm text-[#a3423c]" role="alert">
                  <p>{dataError}</p>
                  <button className="mt-2 font-semibold underline" onClick={() => void refreshData()} type="button">
                    Try again
                  </button>
                </div>
              ) : categories.length === 0 ? (
                <EmptyState
                  title="No categories yet"
                  description="Create your first category to start organizing the menu."
                  href="/admin/categories"
                  action="Add a category"
                />
              ) : (
                <ul className="divide-y divide-[#edf0eb]">
                  {visibleCategories.map((category) => (
                    <CategoryRow
                      category={category}
                      itemCount={itemCountByCategory.get(category.id) ?? 0}
                      key={category.id}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="overflow-hidden rounded-[14px] border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.04)]">
              <div className="flex items-center justify-between border-b border-[#e5e8e2] px-5 py-4">
                <div>
                  <h2 className="font-bold">Menu items at a glance</h2>
                  <p className="mt-1 text-xs text-[#747b75]">A look at current menu items</p>
                </div>
                <Link className="text-xs font-semibold text-[#185c43] hover:text-[#124b36]" href="/admin/menu-items">
                  View menu
                </Link>
              </div>
              {refreshing && !data ? (
                <p className="px-5 py-7 text-sm text-[#747b75]" role="status">Loading menu items…</p>
              ) : dataError && !data ? (
                <div className="px-5 py-7 text-sm text-[#a3423c]" role="alert">
                  <p>{dataError}</p>
                  <button className="mt-2 font-semibold underline" onClick={() => void refreshData()} type="button">
                    Try again
                  </button>
                </div>
              ) : menuHighlights.length === 0 ? (
                <EmptyState
                  title="No menu items yet"
                  description="Add a dish to begin building your restaurant menu."
                  href="/admin/menu-items"
                  action="Add a menu item"
                />
              ) : (
                <ul className="divide-y divide-[#edf0eb] px-5">
                  {menuHighlights.map((item) => (
                    <RecentItem
                      item={item}
                      category={categories.find((entry) => entry.id === item.categoryId)}
                      key={item.id}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="recent-order-status-heading"
              className="vr-dashboard-order-mix overflow-hidden rounded-[14px] border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.04)]"
            >
              <div className="border-b border-[#e5e8e2] px-5 py-4">
                <h2 className="font-bold" id="recent-order-status-heading">
                  Recent order mix
                </h2>
                <p className="mt-1 text-xs text-[#747b75]">
                  Status breakdown across all {recentOrderCount} orders
                </p>
              </div>
              {ordersLoading && orders === null ? (
                <p className="px-5 py-7 text-sm text-[#747b75]" role="status">
                  Loading order activity…
                </p>
              ) : ordersError && orders === null ? (
                <p className="px-5 py-7 text-sm text-[#a3423c]" role="alert">
                  Order activity is unavailable.
                </p>
              ) : recentOrderCount === 0 ? (
                <p className="px-5 py-7 text-sm text-[#747b75]">
                  No recent orders to summarize.
                </p>
              ) : (
                <ul className="space-y-4 px-5 py-5">
                  {recentOrderStatuses.map((status) => (
                    <li key={status.label}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="text-[#747b75]">{status.label}</span>
                        <span className="font-semibold tabular-nums">
                          {status.count}
                        </span>
                      </div>
                      <div
                        aria-label={`${status.label}: ${status.count} orders`}
                        className="h-2 overflow-hidden rounded-full bg-[#f1f3ef]"
                        role="img"
                      >
                        <div
                          className="h-full rounded-full transition-[width] duration-300"
                          style={{
                            width: `${(status.count / recentOrderCount) * 100}%`,
                            backgroundColor: status.color,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
      </main>
    </div>
  );
}

function TaxSettingsCard() {
  const [taxRate, setTaxRate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/tax-settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (
          !response.ok ||
          !isRecord(payload) ||
          typeof payload.taxRatePercent !== "number" ||
          !Number.isFinite(payload.taxRatePercent) ||
          payload.taxRatePercent < 0 ||
          payload.taxRatePercent > 100
        ) {
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not load the tax setting.",
          );
        }
        setTaxRate(String(payload.taxRatePercent));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the tax setting.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const saveTaxRate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setError("");
    const value = Number(taxRate);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      Number(value.toFixed(2)) !== value
    ) {
      setError("Enter a tax rate from 0 to 100 with at most two decimal places.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/tax-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ taxRatePercent: value }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isRecord(payload) ||
        payload.taxRatePercent !== value
      ) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not save the tax setting.",
        );
      }
      setTaxRate(String(payload.taxRatePercent));
      setMessage("Tax rate saved. It will apply to new orders only.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the tax setting.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="tax-settings-heading"
      className="mb-6 rounded-[14px] border border-[#e5e8e2] bg-white p-5 shadow-[0_8px_24px_rgba(26,45,35,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-bold" id="tax-settings-heading">
            GST / Tax settings
          </h2>
          <p className="mt-1 text-xs text-[#747b75]">
            The saved rate applies to new orders. Existing invoices keep their original totals.
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={saveTaxRate}>
          <label className="grid gap-1 text-xs font-medium text-[#747b75]">
            Tax percentage
            <span className="flex items-center gap-2">
              <input
                aria-label="Tax percentage"
                className="w-28 rounded-md border border-[#e5e8e2] px-3 py-2 text-sm text-[#202822]"
                disabled={loading || saving || Boolean(error && !taxRate)}
                max="100"
                min="0"
                onChange={(event) => {
                  setTaxRate(event.target.value);
                  setMessage("");
                  setError("");
                }}
                required
                step="0.01"
                type="number"
                value={taxRate}
              />
              <span>%</span>
            </span>
          </label>
          <button
            className="rounded-md bg-[#185c43] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading || saving || !taxRate}
            type="submit"
          >
            {saving ? "Saving…" : "Save tax rate"}
          </button>
        </form>
      </div>
      {loading && <p className="mt-3 text-xs text-[#747b75]" role="status">Loading tax setting…</p>}
      {error && <p className="mt-3 text-xs text-[#a3423c]" role="alert">{error}</p>}
      {message && <p className="mt-3 text-xs text-[#185c43]" role="status">{message}</p>}
    </section>
  );
}

function OrderRow({
  order,
  isUpdating,
  onStatusChange,
  statusError,
  updatesDisabled,
}: {
  order: AdminOrder;
  isUpdating: boolean;
  onStatusChange: (status: UpdatableOrderStatus) => void;
  statusError: string | undefined;
  updatesDisabled: boolean;
}) {
  const table = Array.isArray(order.restaurant_tables)
    ? order.restaurant_tables[0]
    : order.restaurant_tables;
  const formattedDate = Number.isNaN(Date.parse(order.created_at))
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(order.created_at));
  const statusTone =
    order.status === "cancelled"
      ? "bg-[#f2e9e7] text-[#a25349]"
      : order.status === "ready" || order.status === "served"
        ? "bg-[#e5f1eb] text-[#23704f]"
        : "bg-[#f7eddc] text-[#9a6a22]";

  return (
    <li
      className="vr-dashboard-order-card min-w-0 scroll-mt-6 px-5 py-5 sm:px-6"
      id={`order-${order.id}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs text-[#747b75]">{order.id}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4 lg:min-w-[520px]">
          <div>
            <dt className="text-[10px] font-semibold uppercase text-[#747b75]">Table</dt>
            <dd className="mt-1 text-sm font-medium">{table?.table_number ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase text-[#747b75]">Total</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">
              {formatINR.format(Number(order.total_inr))}
            </dd>
            <dd className="mt-1 text-[10px] text-[#747b75]">
              GST / Tax {Number(order.tax_rate_percent)}% ·{" "}
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 2,
              }).format(Number(order.tax_amount_inr))}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase text-[#747b75]">Placed</dt>
            <dd className="mt-1 text-xs">{formattedDate}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase text-[#747b75]">Status</dt>
            <dd className="mt-1">
              <select
                aria-label={`Update status for order ${order.id}`}
                className={`max-w-full rounded-md border border-[#e5e8e2] px-2 py-1 text-xs font-semibold capitalize ${statusTone}`}
                disabled={updatesDisabled}
                onChange={(event) => {
                  const nextStatus = event.currentTarget.value;
                  if (
                    updatableOrderStatuses.includes(
                      nextStatus as UpdatableOrderStatus,
                    )
                  ) {
                    onStatusChange(nextStatus as UpdatableOrderStatus);
                  }
                }}
                value={order.status}
              >
                {order.status === "pending" && (
                  <option disabled value="pending">Pending</option>
                )}
                {updatableOrderStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              {isUpdating && (
                <span className="ml-2 text-[10px] text-[#747b75]" role="status">
                  Saving…
                </span>
              )}
              {statusError && (
                <p className="mt-1 max-w-36 text-[10px] leading-4 text-[#a3423c]" role="alert">
                  {statusError}
                </p>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 rounded-lg bg-[#f8f9f6] px-3 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase text-[#747b75]">Items</p>
        {order.restaurant_order_items.length === 0 ? (
          <p className="text-xs text-[#747b75]">No item details</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {order.restaurant_order_items.map((item) => (
              <li className="text-xs" key={item.id}>
                <span className="font-medium">{item.item_name}</span>
                <span className="ml-1 text-[#747b75]">× {item.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function CategoryRow({ category, itemCount }: { category: DashboardCategory; itemCount: number }) {
  return (
    <li className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#e5f1eb] text-[#185c43]">
        {category.imageUrl ? (
          // Use a CSS background for a resilient thumbnail without image dependencies.
          <span aria-label={category.name} className="size-full bg-cover bg-center" role="img" style={{ backgroundImage: `url("${category.imageUrl}")` }} />
        ) : (
          <Icon name="category" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{category.name}</span>
        <span className="mt-0.5 block text-xs text-[#747b75]">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
      </span>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${category.isActive ? "bg-[#e3f3ea] text-[#20704d]" : "bg-[#edf0ed] text-[#68716a]"}`}>
        {category.isActive ? "Active" : "Inactive"}
      </span>
    </li>
  );
}

function RecentItem({ item, category }: { item: DashboardMenuItem; category: DashboardCategory | undefined }) {
  return (
    <li className="flex items-center gap-3 py-4">
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[#eef3e8] to-[#f5e9d4]">
        {item.imageUrl ? (
          <span aria-label={`${item.name} image`} className="size-full bg-cover bg-center" role="img" style={{ backgroundImage: `url("${item.imageUrl}")` }} />
        ) : (
          <Icon name="menu" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.name}</span>
        <span className="mt-1 block truncate text-xs text-[#747b75]">
          {category?.name ?? "Uncategorized"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums">{formatINR.format(item.priceINR)}</span>
        <span className={`mt-1 block text-[10px] font-medium ${item.isAvailable ? "text-[#20704d]" : "text-[#a25349]"}`}>
          {item.isAvailable ? "Available" : "Unavailable"}
        </span>
      </span>
    </li>
  );
}

function QuickAction({
  href,
  icon,
  title,
}: {
  href: string;
  icon: "category" | "menu" | "orders" | "analytics";
  title: string;
}) {
  return (
    <Link
      className="vr-dashboard-shortcut"
      href={href}
    >
      <span className="vr-dashboard-shortcut-icon">
        <Icon name={icon} />
      </span>
      <span className="vr-dashboard-shortcut-label">{title}</span>
      <span aria-hidden="true" className="vr-dashboard-shortcut-arrow">
        →
      </span>
    </Link>
  );
}

function EmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="px-6 py-9 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#e5f1eb] text-[#185c43]">
        <Icon name="restaurant" />
      </span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[#747b75]">{description}</p>
      <Link className="mt-4 inline-flex rounded-lg bg-[#185c43] px-3 py-2 text-xs font-semibold text-white hover:bg-[#124b36]" href={href}>
        {action}
      </Link>
    </div>
  );
}

function Icon({
  name,
}: {
  name: "dashboard" | "category" | "menu" | "orders" | "revenue" | "clock" | "restaurant" | "check" | "pause" | "analytics";
}) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    category: <><path d="M20 13 13 20a2 2 0 0 1-3 0l-6-6a2 2 0 0 1 0-3l7-7h7a2 2 0 0 1 2 2Z" /><circle cx="15.5" cy="8.5" r="1" /></>,
    menu: <><path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" /></>,
    orders: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
    revenue: <><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    restaurant: <><path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    analytics: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M19 7v4h-4" /></>,
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
