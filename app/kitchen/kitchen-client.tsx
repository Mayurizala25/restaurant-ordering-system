"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import KitchenConfirmationDialog from "./components/kitchen-confirmation-dialog";
import KitchenOrderCard, {
  type KitchenOrder,
  type OrderStatus,
} from "./components/kitchen-order-card";
import KitchenIcon from "./components/kitchen-icon";
import KitchenWorkspace from "./components/kitchen-workspace";
import { useKitchenTheme } from "./components/use-kitchen-theme";
import { getKitchenAuthenticationPath } from "./kitchen-auth";

type OrderItemRecord = {
  id: string;
  item_name: string;
  quantity: number;
  spice_level: "Mild" | "Medium" | "Spicy";
  special_instructions: string;
  menu_item: { image_url: string } | { image_url: string }[] | null;
};

type OrderTableRecord = { table_number: number; name: string };

type OrderRecord = {
  id: string;
  status: string;
  created_at: string;
  restaurant_tables: OrderTableRecord | OrderTableRecord[] | null;
  restaurant_order_items: OrderItemRecord[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
});
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderItemRecord(value: unknown): value is OrderItemRecord {
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
    typeof value.special_instructions === "string"
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

function isOrderTableRecord(value: unknown): value is OrderTableRecord {
  return (
    isRecord(value) &&
    typeof value.table_number === "number" &&
    Number.isSafeInteger(value.table_number) &&
    typeof value.name === "string"
  );
}

function isOrderRecord(value: unknown): value is OrderRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.status !== "string" ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    !Array.isArray(value.restaurant_order_items) ||
    !value.restaurant_order_items.every(isOrderItemRecord)
  ) {
    return false;
  }

  const table = value.restaurant_tables;
  return (
    table === null ||
    isOrderTableRecord(table) ||
    (Array.isArray(table) && table.every(isOrderTableRecord))
  );
}

function kitchenStatus(status: string): OrderStatus | null {
  switch (status) {
    case "pending":
      return "received";
    case "accepted":
      return "accepted";
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "served":
      return "served";
    case "cancelled":
      return "passed";
    default:
      return null;
  }
}

function databaseStatus(status: OrderStatus): string | null {
  switch (status) {
    case "received":
      return null;
    case "accepted":
      return "accepted";
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "served":
      return "served";
    case "passed":
      return "cancelled";
  }
}

function tableRecord(order: OrderRecord) {
  return Array.isArray(order.restaurant_tables)
    ? order.restaurant_tables[0]
    : order.restaurant_tables;
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

function kitchenOrder(order: OrderRecord): KitchenOrder {
  const status = kitchenStatus(order.status);
  if (!status) throw new Error("An order has an unsupported status.");

  const table = tableRecord(order);
  return {
    id: order.id,
    table: table?.table_number ?? null,
    area: table?.name ?? "",
    elapsed: elapsedTime(order.created_at),
    placedAt: timeFormatter.format(new Date(order.created_at)),
    createdAt: order.created_at,
    status,
    items: order.restaurant_order_items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      name: item.item_name,
      spiceLevel: item.spice_level,
      specialInstructions: item.special_instructions,
      imageUrl: validImageUrl(
        (Array.isArray(item.menu_item)
          ? item.menu_item[0]
          : item.menu_item
        )?.image_url ?? "",
      ),
    })),
  };
}

export default function KitchenClient() {
  const router = useRouter();
  const { theme, themeError, toggleTheme, clearThemeError } = useKitchenTheme();
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [canCancel, setCanCancel] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<OrderStatus>("received");
  const [confirmOrderId, setConfirmOrderId] = useState<string | null>(null);
  const loadInFlight = useRef(false);
  const updateInFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const statusRevision = useRef(0);
  const statusOverrides = useRef(new Map<string, { status: OrderStatus; revision: number }>());

  const refreshOrders = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    if (mounted.current) setRefreshing(true);
    const revisionAtStart = statusRevision.current;
    const controller = new AbortController();
    loadController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/orders", {
        credentials: "include",
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
        router.replace(getKitchenAuthenticationPath("/kitchen"));
        return;
      }
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
        !payload.orders.every(isOrderRecord)
      ) {
        throw new Error("Order data could not be read.");
      }
      setCanCancel(payload.sessionType === "admin");

      const incomingOrders = payload.orders.map((order) => kitchenOrder(order));
      if (!mounted.current) return;
      setOrders(
        incomingOrders.map((order) => {
          const override = statusOverrides.current.get(order.id);
          if (!override) return order;
          if (override.revision > revisionAtStart) {
            return { ...order, status: override.status };
          }
          statusOverrides.current.delete(order.id);
          return order;
        }),
      );
      setLoadError("");
      setUpdatedAt(new Date());
    } catch (cause) {
      if (mounted.current) {
        setLoadError(
          controller.signal.aborted
            ? "Loading orders timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load orders.",
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
      mounted.current = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      loadController.current?.abort();
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("pageshow", handleRefresh);
      window.removeEventListener("virtual-rudra:refresh", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshOrders]);

  const currentOrders = orders ?? [];
  const ordersByStatus = {
    received: currentOrders.filter((order) => order.status === "received"),
    accepted: currentOrders.filter((order) => order.status === "accepted"),
    preparing: currentOrders.filter((order) => order.status === "preparing"),
    ready: currentOrders.filter((order) => order.status === "ready"),
  };
  const counts = {
    received: ordersByStatus.received.length,
    accepted: ordersByStatus.accepted.length,
    preparing: ordersByStatus.preparing.length,
    ready: ordersByStatus.ready.length,
    served: currentOrders.filter((order) => order.status === "served").length,
    active:
      ordersByStatus.received.length +
      ordersByStatus.accepted.length +
      ordersByStatus.preparing.length +
      ordersByStatus.ready.length,
  };
  const lanes = [
    {
      status: "received",
      title: "Received",
      note: "Awaiting acceptance",
      empty: "No received orders",
    },
    {
      status: "accepted",
      title: "Accepted",
      note: "Ready to start",
      empty: "No accepted orders",
    },
    {
      status: "preparing",
      title: "Preparing",
      note: "Orders in preparation",
      empty: "Nothing in preparation",
    },
    {
      status: "ready",
      title: "Ready for Pickup",
      note: "Ready to be handed off",
      empty: "Nothing ready for pickup",
    },
  ] as const;
  const workflowStatuses = [
    ["received", "Received"],
    ["accepted", "Accepted"],
    ["preparing", "Preparing"],
    ["ready", "Ready"],
  ] as const;

  const updateOrder = useCallback(async (id: string, status: OrderStatus) => {
    const nextStatus = databaseStatus(status);
    if (!nextStatus || updateInFlight.current) return;
    updateInFlight.current = true;
    setUpdatingOrderId(id);
    setStatusError("");

    const signal = AbortSignal.timeout(20_000);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, status: nextStatus }),
        cache: "no-store",
        signal,
      });
      if (response.status === 401) {
        router.replace(getKitchenAuthenticationPath("/kitchen"));
        return;
      }
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
        payload.order.id !== id ||
        payload.order.status !== nextStatus
      ) {
        throw new Error("Order status could not be confirmed.");
      }

      const displayStatus = kitchenStatus(payload.order.status);
      if (!displayStatus) throw new Error("The updated order status is unsupported.");
      const revision = ++statusRevision.current;
      statusOverrides.current.set(id, { status: displayStatus, revision });
      setOrders((current) =>
        current?.map((order) =>
          order.id === id ? { ...order, status: displayStatus } : order,
        ) ?? null,
      );
    } catch (cause) {
      if (mounted.current) {
        setStatusError(
          signal.aborted
            ? "Updating the order status timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not update the order status.",
        );
      }
    } finally {
      updateInFlight.current = false;
      if (mounted.current) setUpdatingOrderId(null);
    }
  }, [router]);

  function requestStatusChange(id: string, status: OrderStatus) {
    if (status === "served") {
      setConfirmOrderId(id);
      return;
    }
    void updateOrder(id, status);
  }

  return (
    <KitchenWorkspace
      activeCount={counts.active}
      currentView="dashboard"
      isConnected={updatedAt !== null && !loadError}
      onThemeToggle={toggleTheme}
      theme={theme}
      title="Kitchen Dashboard"
    >
      <main className="k-main">
        <section className="k-page-heading">
          <div>
            <span className="k-eyebrow">VIRTUAL RUDRA · LIVE SHIFT</span>
            <h1>Kitchen Dashboard</h1>
            <p>Active orders requiring kitchen attention.</p>
          </div>
          <div className="k-active-summary">
            <strong>{counts.active}</strong>
            <span>Active orders</span>
          </div>
        </section>

        <div className="k-feed-toolbar">
          <span>
            <i />
            {updatedAt
              ? `Feed synchronized · ${timeFormatter.format(updatedAt)}`
              : "Connecting to live feed"}
          </span>
          <button
            aria-label="Refresh orders"
            disabled={refreshing}
            onClick={() => void refreshOrders()}
            type="button"
          >
            <KitchenIcon name="refresh" size={16} />
            {refreshing ? "Syncing" : "Refresh"}
          </button>
        </div>

        {loadError && (
          <div className="k-alert" role="alert">
            <span>{loadError}</span>
            <button onClick={() => void refreshOrders()} type="button">Try again</button>
          </div>
        )}
        {statusError && (
          <div className="k-alert" role="alert">
            <span>{statusError}</span>
            <button onClick={() => setStatusError("")} type="button">Dismiss</button>
          </div>
        )}
        {themeError && (
          <div className="k-alert" role="alert">
            <span>{themeError}</span>
            <button onClick={clearThemeError} type="button">Dismiss</button>
          </div>
        )}

        {loading && orders === null ? (
          <div aria-live="polite" className="k-state">
            <span className="k-state-spinner" />
            Loading live orders…
          </div>
        ) : orders === null ? (
          <div className="k-empty">
            <span><KitchenIcon name="refresh" size={28} /></span>
            <h2>Orders are unavailable</h2>
            <p>Check the connection and try loading the live feed again.</p>
            <button onClick={() => void refreshOrders()} type="button">Try again</button>
          </div>
        ) : (
          <>
            <nav aria-label="Order status filters" className="k-status-filters">
              {workflowStatuses.map(([status, label]) => (
                <button
                  aria-pressed={activeFilter === status}
                  className={activeFilter === status ? "active" : ""}
                  key={status}
                  onClick={() => setActiveFilter(status)}
                  type="button"
                >
                  <i className={`dot-${status}`} />
                  <span>{label}</span>
                  <strong>{counts[status]}</strong>
                </button>
              ))}
            </nav>
            <section aria-label="Kitchen order queues" className="k-board">
              {lanes.map((lane) => {
                const laneOrders = ordersByStatus[lane.status];
                return (
                  <section
                    aria-label={`${lane.title} queue`}
                    className={`k-board-column ${activeFilter === lane.status ? "mobile-active" : ""}`}
                    key={lane.status}
                  >
                    <header>
                      <div>
                        <i className={`dot-${lane.status}`} />
                        <b>{lane.title}</b>
                      </div>
                      <span>{laneOrders.length}</span>
                    </header>
                    {laneOrders.length ? (
                      laneOrders.map((order) => (
                        <KitchenOrderCard
                          canCancel={canCancel}
                          isUpdating={updatingOrderId !== null}
                          key={order.id}
                          onOpen={() => router.push(`/kitchen/orders/${order.id}`)}
                          onStatusChange={requestStatusChange}
                          order={order}
                        />
                      ))
                    ) : (
                      <div className="k-column-empty">
                        <KitchenIcon name="check" />
                        <span>{lane.empty}</span>
                      </div>
                    )}
                  </section>
                );
              })}
            </section>
          </>
        )}

        <footer className="k-footer">
          <span><i /> Virtual Rudra Kitchen</span>
          <span>{counts.active} Active Orders</span>
          <span>{counts.served} Served</span>
          <small>{updatedAt ? `Last sync ${timeFormatter.format(updatedAt)}` : "Waiting for first sync"}</small>
        </footer>
      </main>
      {confirmOrderId && (
        <KitchenConfirmationDialog
          busy={updatingOrderId === confirmOrderId}
          onCancel={() => setConfirmOrderId(null)}
          onConfirm={() => {
            setConfirmOrderId(null);
            void updateOrder(confirmOrderId, "served");
          }}
          orderLabel={`Order #${confirmOrderId.slice(0, 8).toUpperCase()}`}
        />
      )}
    </KitchenWorkspace>
  );
}
