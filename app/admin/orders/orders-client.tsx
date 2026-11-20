"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPageHeading } from "../_components/admin-page";
import { useAdmin } from "../_lib/admin-provider";
import {
  createTimeoutSignal,
  fetchJsonWithTimeout,
  RequestCancelledError,
  RequestTimeoutError,
} from "../_lib/request-timeout";

const updatableStatuses = [
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;
type UpdatableStatus = (typeof updatableStatuses)[number];
type StatusFilter =
  | "all"
  | "pending"
  | "in_progress"
  | "ready"
  | "served"
  | "cancelled";
type DateFilter = "all" | "7days";

type OrderItem = {
  id: string;
  item_name: string;
  quantity: number;
  spice_level: "Mild" | "Medium" | "Spicy";
  special_instructions: string;
};

type OrderTable = { table_number: number };

type AdminOrder = {
  id: string;
  status: string;
  total_inr: number | string;
  tax_rate_percent: number | string;
  tax_amount_inr: number | string;
  coupon_code: string | null;
  coupon_discount_inr: number | string;
  created_at: string;
  restaurant_tables: OrderTable | OrderTable[] | null;
  restaurant_order_items: OrderItem[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_ORDERS: AdminOrder[] = [];

const statusTabs: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All orders" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In progress" },
  { value: "ready", label: "Ready" },
  { value: "served", label: "Served" },
  { value: "cancelled", label: "Cancelled" },
];

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const preciseMoney = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const orderDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const updatedTime = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderItem(value: unknown): value is OrderItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.item_name === "string" &&
    typeof value.quantity === "number" &&
    Number.isSafeInteger(value.quantity) &&
    (value.spice_level === "Mild" ||
      value.spice_level === "Medium" ||
      value.spice_level === "Spicy") &&
    typeof value.special_instructions === "string"
  );
}

function isOrder(value: unknown): value is AdminOrder {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    (typeof value.total_inr !== "number" &&
      typeof value.total_inr !== "string") ||
    !Number.isFinite(Number(value.total_inr)) ||
    (typeof value.tax_rate_percent !== "number" &&
      typeof value.tax_rate_percent !== "string") ||
    !Number.isFinite(Number(value.tax_rate_percent)) ||
    Number(value.tax_rate_percent) < 0 ||
    Number(value.tax_rate_percent) > 100 ||
    (typeof value.tax_amount_inr !== "number" &&
      typeof value.tax_amount_inr !== "string") ||
    !Number.isFinite(Number(value.tax_amount_inr)) ||
    Number(value.tax_amount_inr) < 0 ||
    (value.coupon_code !== null &&
      (typeof value.coupon_code !== "string" ||
        value.coupon_code.length > 32)) ||
    (typeof value.coupon_discount_inr !== "number" &&
      typeof value.coupon_discount_inr !== "string") ||
    !Number.isFinite(Number(value.coupon_discount_inr)) ||
    Number(value.coupon_discount_inr) < 0 ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.restaurant_order_items) ||
    !value.restaurant_order_items.every(isOrderItem)
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

function matchesStatus(status: string, filter: StatusFilter) {
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return status === "pending";
    case "in_progress":
      return status === "accepted" || status === "preparing";
    case "ready":
      return status === "ready";
    case "served":
      return status === "served";
    case "cancelled":
      return status === "cancelled";
  }
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(status: string) {
  if (status === "cancelled") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  if (status === "ready" || status === "served") {
    return "border-sage/30 bg-sage-soft text-sage";
  }
  return "border-accent/30 bg-accent-soft text-accent";
}

function tableNumber(order: AdminOrder) {
  const table = Array.isArray(order.restaurant_tables)
    ? order.restaurant_tables[0]
    : order.restaurant_tables;
  return table?.table_number ?? null;
}

function isUpdatableStatus(status: string): status is UpdatableStatus {
  return updatableStatuses.some((value) => value === status);
}

export default function AdminOrdersClient() {
  const { syncNotifications } = useAdmin();
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const loadInFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const statusRevision = useRef(0);
  const statusOverrides = useRef(
    new Map<string, { status: string; revision: number }>(),
  );

  const refreshOrders = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const revisionAtStart = statusRevision.current;
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        "/api/orders",
        { cache: "no-store", signal: controller.signal },
        15_000,
      );
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not load orders.",
        );
      }
      if (
        !isRecord(payload) ||
        typeof payload.restaurantId !== "string" ||
        !UUID_PATTERN.test(payload.restaurantId) ||
        !Array.isArray(payload.orders) ||
        !payload.orders.every(isOrder)
      ) {
        throw new Error("Order data could not be read.");
      }

      syncNotifications(payload.restaurantId, payload.orders);
      setOrders(
        payload.orders.map((order) => {
          const override = statusOverrides.current.get(order.id);
          if (!override) return order;
          if (override.revision > revisionAtStart) {
            return { ...order, status: override.status };
          }
          statusOverrides.current.delete(order.id);
          return order;
        }),
      );
      setUpdatedAt(new Date());
    } catch (cause) {
      if (!(cause instanceof RequestCancelledError)) {
        setLoadError(
          cause instanceof RequestTimeoutError
            ? "Loading orders timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load orders.",
        );
      }
    } finally {
      if (loadController.current === controller) loadController.current = null;
      loadInFlight.current = false;
      setLoading(false);
    }
  }, [syncNotifications]);

  const updateOrderStatus = useCallback(
    async (orderId: string, status: UpdatableStatus) => {
      setUpdatingOrderId(orderId);
      setStatusErrors((current) => {
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
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not update the order status.",
          );
        }
        if (
          !isRecord(payload) ||
          !isRecord(payload.order) ||
          payload.order.id !== orderId ||
          payload.order.status !== status
        ) {
          throw new Error("Order status could not be confirmed.");
        }

        const revision = ++statusRevision.current;
        statusOverrides.current.set(orderId, { status, revision });
        setOrders((current) =>
          current?.map((order) =>
            order.id === orderId ? { ...order, status } : order,
          ) ?? null,
        );
      } catch (cause) {
        setStatusErrors((current) => ({
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
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshOrders(), 0);
    const interval = window.setInterval(() => void refreshOrders(), 15_000);
    const handleRefresh = () => void refreshOrders();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshOrders();
    };
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("pageshow", handleRefresh);
    window.addEventListener("virtual-rudra:refresh", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      loadController.current?.abort();
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("pageshow", handleRefresh);
      window.removeEventListener("virtual-rudra:refresh", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshOrders]);

  const allOrders = orders ?? EMPTY_ORDERS;
  const counts: Record<StatusFilter, number> = {
    all: allOrders.length,
    pending: allOrders.filter((order) => order.status === "pending").length,
    in_progress: allOrders.filter(
      (order) => order.status === "accepted" || order.status === "preparing",
    ).length,
    ready: allOrders.filter((order) => order.status === "ready").length,
    served: allOrders.filter((order) => order.status === "served").length,
    cancelled: allOrders.filter((order) => order.status === "cancelled").length,
  };
  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    const cutoff =
      dateFilter === "7days" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;
    return allOrders.filter((order) => {
      if (!matchesStatus(order.status, statusFilter)) return false;
      const createdAt = Date.parse(order.created_at);
      if (cutoff && (!Number.isFinite(createdAt) || createdAt < cutoff)) {
        return false;
      }
      const table = tableNumber(order);
      return (
        !query ||
        order.id.toLowerCase().includes(query) ||
        String(table ?? "").includes(query) ||
        order.restaurant_order_items.some((item) =>
          item.item_name.toLowerCase().includes(query),
        )
      );
    });
  }, [allOrders, dateFilter, search, statusFilter]);
  const summary = [
    { label: "Total orders", value: counts.all, detail: "All orders received" },
    { label: "Pending", value: counts.pending, detail: "Awaiting confirmation" },
    { label: "In progress", value: counts.in_progress, detail: "Accepted or preparing" },
    { label: "Served", value: counts.served, detail: "Completed orders" },
  ];

  return (
    <main className="vr-admin-management-page mx-auto w-full max-w-[1450px] px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <AdminPageHeading
        description="Review incoming orders and keep each table moving through service."
        eyebrow="RESTAURANT OPERATIONS"
        title="Order Management"
      >
        <div className="flex items-center justify-end gap-3">
          {updatedAt && (
            <span className="text-xs text-muted">
              Updated {updatedTime.format(updatedAt)}
            </span>
          )}
          <button
            aria-label="Refresh orders"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground transition hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
            disabled={loading}
            onClick={() => void refreshOrders()}
            type="button"
          >
            <svg
              aria-hidden="true"
              className={`size-4 ${loading ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" />
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </AdminPageHeading>

      {loadError && (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <span>{loadError}</span>
          <button
            className="font-semibold underline"
            onClick={() => void refreshOrders()}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      <section
        aria-label="Order counts"
        className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        {summary.map((card) => (
          <article
            className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow)] sm:p-5"
            key={card.label}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
              {orders ? card.value.toLocaleString("en-IN") : "—"}
            </p>
            <p className="mt-1 text-xs text-muted">{card.detail}</p>
          </article>
        ))}
      </section>

      <section
        aria-label="Order list"
        aria-busy={loading}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]"
      >
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-semibold text-foreground">Orders</h2>
              <p className="mt-1 text-xs text-muted">
                {orders
                  ? `Showing ${filteredOrders.length} of ${orders.length} orders`
                  : loadError
                    ? "Order data is unavailable."
                    : "Loading saved orders…"}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px]">
              <label className="relative block min-w-0">
                <span className="sr-only">Search orders</span>
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search order, table, or item"
                  type="search"
                  value={search}
                />
              </label>
              <label>
                <span className="sr-only">Filter orders by date</span>
                <select
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                  onChange={(event) =>
                    setDateFilter(
                      event.currentTarget.value === "7days" ? "7days" : "all",
                    )
                  }
                  value={dateFilter}
                >
                  <option value="all">Any date</option>
                  <option value="7days">Last 7 days</option>
                </select>
              </label>
            </div>
          </div>
          <div
            aria-label="Filter orders by status"
            className="mt-4 flex gap-2 overflow-x-auto pb-1"
            role="group"
          >
            {statusTabs.map((tab) => (
              <button
                aria-pressed={statusFilter === tab.value}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${
                  statusFilter === tab.value
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface-2 text-muted hover:text-foreground"
                }`}
                disabled={!orders}
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                type="button"
              >
                {tab.label}
                <span className="tabular-nums">
                  {orders ? counts[tab.value] : "—"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!orders ? (
          <div className="px-6 py-14 text-center text-sm text-muted" role="status">
            {loadError ? "Orders could not be loaded." : "Loading orders…"}
          </div>
        ) : filteredOrders.length ? (
          <div className="grid gap-3 p-3 sm:gap-4 sm:p-5 xl:grid-cols-2">
            {filteredOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                isUpdating={updatingOrderId === order.id}
                statusError={statusErrors[order.id]}
                updatesDisabled={updatingOrderId !== null}
                onStatusChange={(status) =>
                  void updateOrderStatus(order.id, status)
                }
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-foreground">
              {orders.length ? "No orders match these filters." : "No orders yet"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {orders.length
                ? "Try another search or clear the selected filters."
                : "New orders will appear here as they arrive."}
            </p>
            {orders.length > 0 && (
              <button
                className="mt-4 text-sm font-semibold text-accent hover:underline"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setDateFilter("all");
                }}
                type="button"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function OrderCard({
  order,
  isUpdating,
  statusError,
  updatesDisabled,
  onStatusChange,
}: {
  order: AdminOrder;
  isUpdating: boolean;
  statusError: string | undefined;
  updatesDisabled: boolean;
  onStatusChange: (status: UpdatableStatus) => void;
}) {
  const placedAt = Number.isNaN(Date.parse(order.created_at))
    ? "Date unavailable"
    : orderDate.format(new Date(order.created_at));
  const table = tableNumber(order);

  return (
    <article
      className="min-w-0 rounded-2xl border border-border bg-background/50 p-4 transition hover:border-accent/50 sm:p-5"
      id={`order-${order.id}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Order
          </p>
          <p
            className="mt-1 truncate font-mono text-sm font-semibold text-foreground"
            title={order.id}
          >
            #{order.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="mt-1 text-xs text-muted">{placedAt}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone(order.status)}`}
        >
          {statusLabel(order.status)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface px-3 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Table
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {table === null ? "—" : `Table ${table}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Total
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-foreground">
            {money.format(Number(order.total_inr))}
          </p>
          <p className="mt-1 text-[10px] text-muted">
            GST / Tax {Number(order.tax_rate_percent)}% ·{" "}
            {preciseMoney.format(Number(order.tax_amount_inr))}
          </p>
          {order.coupon_code && (
            <p className="mt-1 text-[10px] text-muted">
              Coupon {order.coupon_code} ·{" "}
              {preciseMoney.format(Number(order.coupon_discount_inr))} off
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Items
        </p>
        {order.restaurant_order_items.length ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {order.restaurant_order_items.map((item) => (
              <li className="min-w-0 text-xs text-foreground" key={item.id}>
                <span className="break-words font-medium">{item.item_name}</span>
                <span className="ml-1 text-muted">× {item.quantity}</span>
                <span className="ml-2 text-muted">· {item.spice_level}</span>
                {item.special_instructions && (
                  <span className="mt-1 block break-words text-muted">
                    Note: {item.special_instructions}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted">No item details</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted">
          Update status
          <select
            aria-label={`Update status for order ${order.id}`}
            className={`h-9 min-w-0 rounded-lg border border-border bg-surface px-2 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 ${
              statusTone(order.status)
            }`}
            disabled={updatesDisabled}
            onChange={(event) => {
              const nextStatus = event.currentTarget.value;
              if (isUpdatableStatus(nextStatus)) onStatusChange(nextStatus);
            }}
            value={order.status}
          >
            {order.status === "pending" && (
              <option disabled value="pending">
                Pending
              </option>
            )}
            {!isUpdatableStatus(order.status) && order.status !== "pending" && (
              <option disabled value={order.status}>
                {statusLabel(order.status)}
              </option>
            )}
            {updatableStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        {isUpdating && (
          <span className="text-xs text-muted" role="status">
            Saving…
          </span>
        )}
      </div>
      {statusError && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {statusError}
        </p>
      )}
    </article>
  );
}
