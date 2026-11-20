"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import KitchenOrderCard, {
  type KitchenOrder,
  type OrderStatus as KitchenOrderStatus,
} from "../components/kitchen-order-card";
import KitchenIcon from "../components/kitchen-icon";
import KitchenWorkspace from "../components/kitchen-workspace";
import { useKitchenTheme } from "../components/use-kitchen-theme";
import { getKitchenAuthenticationPath } from "../kitchen-auth";

type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";
type OrderItem = {
  id: string;
  item_name: string;
  quantity: number;
  spice_level: "Mild" | "Medium" | "Spicy";
  special_instructions: string;
  unit_price_inr: number | string;
  line_total_inr: number | string;
  menu_item:
    | { image_url: string }
    | { image_url: string }[]
    | null;
};
type OrderTable = { table_number: number; name: string };
type HistoryOrder = {
  id: string;
  status: OrderStatus;
  total_inr: number | string;
  created_at: string;
  restaurant_tables: OrderTable | OrderTable[] | null;
  restaurant_order_items: OrderItem[];
};
type HistoryFilter = "all" | "completed" | "cancelled";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const timeOnly = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
});
const filterOptions: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "preparing" ||
    value === "ready" ||
    value === "served" ||
    value === "cancelled"
  );
}

function isOrderItem(value: unknown): value is OrderItem {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.item_name === "string" &&
    typeof value.quantity === "number" &&
    Number.isSafeInteger(value.quantity) &&
    value.quantity > 0 &&
    (value.spice_level === "Mild" ||
      value.spice_level === "Medium" ||
      value.spice_level === "Spicy") &&
    typeof value.special_instructions === "string" &&
    (typeof value.unit_price_inr === "number" ||
      typeof value.unit_price_inr === "string") &&
    Number.isFinite(Number(value.unit_price_inr)) &&
    (typeof value.line_total_inr === "number" ||
      typeof value.line_total_inr === "string") &&
    Number.isFinite(Number(value.line_total_inr))
  ) {
    const menuItem = value.menu_item;
    return (
      menuItem === null ||
      (isRecord(menuItem) && typeof menuItem.image_url === "string") ||
      (Array.isArray(menuItem) &&
        menuItem.every(
          (item) => isRecord(item) && typeof item.image_url === "string",
        ))
    );
  }
  return false;
}

function isOrderTable(value: unknown): value is OrderTable {
  return (
    isRecord(value) &&
    typeof value.table_number === "number" &&
    Number.isSafeInteger(value.table_number) &&
    typeof value.name === "string"
  );
}

function isHistoryOrder(value: unknown): value is HistoryOrder {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    !isOrderStatus(value.status) ||
    (typeof value.total_inr !== "number" &&
      typeof value.total_inr !== "string") ||
    !Number.isFinite(Number(value.total_inr)) ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    !Array.isArray(value.restaurant_order_items) ||
    !value.restaurant_order_items.every(isOrderItem)
  ) {
    return false;
  }

  const table = value.restaurant_tables;
  return (
    table === null ||
    isOrderTable(table) ||
    (Array.isArray(table) && table.every(isOrderTable))
  );
}

function tableRecord(order: HistoryOrder) {
  return Array.isArray(order.restaurant_tables)
    ? order.restaurant_tables[0]
    : order.restaurant_tables;
}

function orderLink(order: HistoryOrder) {
  return `/kitchen/orders/${order.id}`;
}

function validImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function kitchenStatus(status: OrderStatus): KitchenOrderStatus {
  if (status === "pending") return "received";
  if (status === "cancelled") return "passed";
  return status;
}

function elapsedTime(createdAt: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(createdAt)) / 60_000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function kitchenOrder(order: HistoryOrder): KitchenOrder {
  const table = tableRecord(order);
  return {
    id: order.id,
    table: table?.table_number ?? null,
    area: table?.name ?? "",
    elapsed: elapsedTime(order.created_at),
    placedAt: timeOnly.format(new Date(order.created_at)),
    createdAt: order.created_at,
    status: kitchenStatus(order.status),
    total: currency.format(Number(order.total_inr)),
    items: order.restaurant_order_items.map((item) => {
      const menuItem = Array.isArray(item.menu_item)
        ? item.menu_item[0]
        : item.menu_item;
      return {
        id: item.id,
        quantity: item.quantity,
        name: item.item_name,
        spiceLevel: item.spice_level,
        specialInstructions: item.special_instructions,
        imageUrl: validImageUrl(menuItem?.image_url ?? ""),
      };
    }),
  };
}

export default function KitchenHistoryClient() {
  const router = useRouter();
  const { theme, themeError, toggleTheme, clearThemeError } = useKitchenTheme();
  const [orders, setOrders] = useState<HistoryOrder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const loadInFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refreshOrders = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const controller = new AbortController();
    loadController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setRefreshing(true);

    try {
      const response = await fetch("/api/orders", {
        cache: "no-store",
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Order data could not be read.");
      }

      if (response.status === 401) {
        router.replace(getKitchenAuthenticationPath("/kitchen/history"));
        return;
      }
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not load order history.",
        );
      }
      if (
        !isRecord(payload) ||
        typeof payload.restaurantId !== "string" ||
        !UUID_PATTERN.test(payload.restaurantId) ||
        !Array.isArray(payload.orders) ||
        !payload.orders.every(isHistoryOrder)
      ) {
        throw new Error("Order history data could not be read.");
      }

      if (!mounted.current) return;
      setOrders(payload.orders);
      setLoadError("");
      setUpdatedAt(new Date());
    } catch (cause) {
      if (mounted.current) {
        setLoadError(
          controller.signal.aborted
            ? "Loading order history timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load order history.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (loadController.current === controller) loadController.current = null;
      loadInFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [router]);

  useEffect(() => {
    mounted.current = true;
    const initialLoad = window.setTimeout(() => void refreshOrders(), 0);
    const interval = window.setInterval(() => void refreshOrders(), 30_000);
    const handleRefresh = () => void refreshOrders();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshOrders();
    };
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("pageshow", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted.current = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      loadController.current?.abort();
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("pageshow", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshOrders]);

  const counts = {
    all: orders?.length ?? 0,
    completed: orders?.filter((order) => order.status === "served").length ?? 0,
    cancelled: orders?.filter((order) => order.status === "cancelled").length ?? 0,
  };
  const activeCount =
    orders?.filter(
      (order) =>
        order.status === "pending" ||
        order.status === "accepted" ||
        order.status === "preparing" ||
        order.status === "ready",
    ).length ?? 0;
  const filteredOrders = useMemo(() => {
    const query = search.trim().replace(/^#/, "").toLowerCase();
    return (orders ?? []).filter((order) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "completed" && order.status === "served") ||
        (filter === "cancelled" && order.status === "cancelled");
      const table = tableRecord(order);
      const matchesSearch =
        !query ||
        order.id.toLowerCase().includes(query) ||
        order.id.slice(0, 8).toLowerCase().includes(query) ||
        String(table?.table_number ?? "").includes(query) ||
        (table?.name ?? "").toLowerCase().includes(query) ||
        order.restaurant_order_items.some((item) =>
          item.item_name.toLowerCase().includes(query),
        );
      return matchesFilter && matchesSearch;
    });
  }, [filter, orders, search]);

  function resetFilters() {
    setFilter("all");
    setSearch("");
  }

  return (
    <KitchenWorkspace
      activeCount={activeCount}
      currentView="history"
      isConnected={updatedAt !== null && !loadError}
      onThemeToggle={toggleTheme}
      theme={theme}
      title="Order History"
    >
      <main className="k-main k-history-main">
        <section className="k-page-heading">
          <div>
            <span className="k-eyebrow">SERVICE ARCHIVE</span>
            <h1>Order History</h1>
            <p>Review completed and cancelled kitchen orders.</p>
          </div>
        </section>

        <div className="k-history-toolbar">
          <div aria-label="Filter order history" className="k-filter-tabs" role="tablist">
            {filterOptions.map((option) => (
              <button
                aria-selected={filter === option.value}
                className={filter === option.value ? "active" : ""}
                key={option.value}
                onClick={() => setFilter(option.value)}
                role="tab"
                type="button"
              >
                {option.label === "Completed" ? "Served / Completed" : option.label}
                <small>{orders ? counts[option.value] : "—"}</small>
              </button>
            ))}
          </div>
          <label className="k-search">
            <span className="sr-only">Search by order ID, table, or dish</span>
            <KitchenIcon name="search" />
            <input
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search by order ID, table, dish…"
              type="search"
              value={search}
            />
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => setSearch("")}
                type="button"
              >
                <KitchenIcon name="close" size={15} />
              </button>
            )}
          </label>
        </div>

        <div className="k-history-result">
          <span>
            {orders
              ? `Showing ${filteredOrders.length} of ${orders.length} orders`
              : "Loading saved orders…"}
            {updatedAt && <small> · Updated {timeOnly.format(updatedAt)}</small>}
          </span>
          <div>
            {(filter !== "all" || search) && (
              <button onClick={resetFilters} type="button">Reset filters</button>
            )}
            <button
              aria-label="Refresh order history"
              disabled={refreshing}
              onClick={() => void refreshOrders()}
              type="button"
            >
              <KitchenIcon name="refresh" size={16} />
              {refreshing ? "Syncing" : "Refresh"}
            </button>
          </div>
        </div>

        {themeError && (
          <div className="k-alert" role="alert">
            <span>{themeError}</span>
            <button onClick={clearThemeError} type="button">Dismiss</button>
          </div>
        )}
        {loadError && (
          <div className="k-alert" role="alert">
            <span>{loadError}</span>
            <button onClick={() => void refreshOrders()} type="button">Try again</button>
          </div>
        )}

        {loading && orders === null ? (
          <div aria-live="polite" className="k-state">
            <span className="k-state-spinner" />
            Loading order history…
          </div>
        ) : orders === null ? (
          <div className="k-empty">
            <span><KitchenIcon name="refresh" size={28} /></span>
            <h2>Order history is unavailable</h2>
            <p>Check the connection and try loading the archive again.</p>
            <button onClick={() => void refreshOrders()} type="button">Try again</button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="k-empty">
            <span><KitchenIcon name="search" size={28} /></span>
            <h2>{orders.length ? "No matching orders" : "No order history yet"}</h2>
            <p>
              {orders.length
                ? "Try another order ID or reset the selected filters."
                : "Completed and cancelled orders will appear here."}
            </p>
            {(filter !== "all" || search) && (
              <button onClick={resetFilters} type="button">Reset filters</button>
            )}
          </div>
        ) : (
          <section aria-label="Order history list" className="k-history-list">
            {filteredOrders.map((order) => (
              <KitchenOrderCard
                history
                historyHref={orderLink(order)}
                historyValue={currency.format(Number(order.total_inr))}
                key={order.id}
                order={kitchenOrder(order)}
              />
            ))}
          </section>
        )}

        <footer className="k-footer">
          <span><i /> Order records are securely synced from your kitchen service.</span>
          {orders && (
            <small>
              {counts.all} records · {counts.completed} completed · {counts.cancelled} cancelled
            </small>
          )}
        </footer>
      </main>
    </KitchenWorkspace>
  );
}
