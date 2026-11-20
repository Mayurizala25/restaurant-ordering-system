"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import KitchenConfirmationDialog from "../../components/kitchen-confirmation-dialog";
import KitchenIcon from "../../components/kitchen-icon";
import KitchenWorkspace from "../../components/kitchen-workspace";
import { useKitchenTheme } from "../../components/use-kitchen-theme";
import { getKitchenAuthenticationPath } from "../../kitchen-auth";

type TableRecord = { table_number: number; name: string };
type OrderItemRecord = {
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
type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";
type OrderRecord = {
  id: string;
  status: OrderStatus;
  total_inr: number | string;
  created_at: string;
  restaurant_tables: TableRecord | TableRecord[] | null;
  restaurant_order_items: OrderItemRecord[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const progressSteps = ["Received", "Accepted", "Preparing", "Ready", "Served"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderStatus(value: unknown): value is OrderStatus {
  switch (value) {
    case "pending":
    case "accepted":
    case "preparing":
    case "ready":
    case "served":
    case "cancelled":
      return true;
    default:
      return false;
  }
}

function isTableRecord(value: unknown): value is TableRecord {
  return (
    isRecord(value) &&
    typeof value.table_number === "number" &&
    Number.isSafeInteger(value.table_number) &&
    typeof value.name === "string"
  );
}

function isOrderItemRecord(value: unknown): value is OrderItemRecord {
  return (
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
    Number.isFinite(Number(value.line_total_inr)) &&
    (value.menu_item === null ||
      (isRecord(value.menu_item) && typeof value.menu_item.image_url === "string") ||
      (Array.isArray(value.menu_item) &&
        value.menu_item.every(
          (item) => isRecord(item) && typeof item.image_url === "string",
        )))
  );
}

function isOrderRecord(value: unknown): value is OrderRecord {
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
    !value.restaurant_order_items.every(isOrderItemRecord)
  ) {
    return false;
  }

  const table = value.restaurant_tables;
  return (
    table === null ||
    isTableRecord(table) ||
    (Array.isArray(table) && table.every(isTableRecord))
  );
}

function tableRecord(order: OrderRecord) {
  return Array.isArray(order.restaurant_tables)
    ? order.restaurant_tables[0]
    : order.restaurant_tables;
}

function progressIndex(status: OrderStatus) {
  switch (status) {
    case "pending":
      return 0;
    case "accepted":
      return 1;
    case "preparing":
      return 2;
    case "ready":
      return 3;
    case "served":
      return 4;
    case "cancelled":
      return -1;
  }
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

function elapsedTime(createdAt: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(createdAt)) / 60_000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function displayStatus(status: OrderStatus) {
  switch (status) {
    case "pending":
      return "Received";
    case "accepted":
      return "Accepted";
    case "preparing":
      return "Preparing";
    case "ready":
      return "Ready";
    case "served":
      return "Served / Completed";
    case "cancelled":
      return "Cancelled";
  }
}

function displayStatusClass(status: OrderStatus) {
  if (status === "pending") return "received";
  if (status === "cancelled") return "passed";
  return status;
}

export default function KitchenOrderDetailClient({
  orderId,
}: {
  orderId: string;
}) {
  const router = useRouter();
  const { theme, themeError, toggleTheme, clearThemeError } = useKitchenTheme();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [canCancel, setCanCancel] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [confirmServe, setConfirmServe] = useState(false);
  const statusRevision = useRef(0);
  const statusOverrides = useRef(
    new Map<string, { status: OrderStatus; revision: number }>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let requestInFlight = false;

    async function loadOrder() {
      if (requestInFlight) return;
      requestInFlight = true;
      const revisionAtStart = statusRevision.current;
      setLoading(true);
      setLoadError("");
      try {
        if (!UUID_PATTERN.test(orderId)) {
          setOrder(null);
          return;
        }

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
          router.replace(
            getKitchenAuthenticationPath(`/kitchen/orders/${orderId}`),
          );
          return;
        }
        if (!response.ok) {
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not load this order.",
          );
        }
        if (
          !isRecord(payload) ||
          !Array.isArray(payload.orders) ||
          !payload.orders.every(isOrderRecord)
        ) {
          throw new Error("Order data could not be read.");
        }
        if (!active || controller.signal.aborted) return;

        setCanCancel(payload.sessionType === "admin");
        setActiveCount(
          payload.orders.filter(
            (candidate) =>
              isRecord(candidate) &&
              (candidate.status === "pending" ||
                candidate.status === "accepted" ||
                candidate.status === "preparing" ||
                candidate.status === "ready"),
          ).length,
        );

        let incomingOrder =
          payload.orders.find((candidate) => candidate.id === orderId) ?? null;
        const override = statusOverrides.current.get(orderId);
        if (incomingOrder && override) {
          if (override.revision > revisionAtStart) {
          incomingOrder = { ...incomingOrder, status: override.status };
          } else {
          statusOverrides.current.delete(orderId);
          }
        }
        setOrder(incomingOrder);
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setLoadError(
            cause instanceof Error ? cause.message : "Could not load this order.",
          );
        }
      } finally {
        requestInFlight = false;
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }

    void loadOrder();
    const interval = window.setInterval(() => void loadOrder(), 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [orderId, retryCount, router]);

  async function updateStatus(status: OrderStatus) {
    if (!order || updating) return;
    setUpdating(true);
    setStatusError("");

    const signal = AbortSignal.timeout(20_000);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status }),
        cache: "no-store",
        signal,
      });
      if (response.status === 401) {
        router.replace(
          getKitchenAuthenticationPath(`/kitchen/orders/${order.id}`),
        );
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
      if (!isRecord(payload) || !isRecord(payload.order)) {
        throw new Error("Order status could not be confirmed.");
      }
      const updatedStatus = payload.order.status;
      if (
        payload.order.id !== order.id ||
        !isOrderStatus(updatedStatus) ||
        updatedStatus !== status
      ) {
        throw new Error("Order status could not be confirmed.");
      }

      const revision = ++statusRevision.current;
      statusOverrides.current.set(order.id, {
        status: updatedStatus,
        revision,
      });
      setOrder((current) =>
        current ? { ...current, status: updatedStatus } : current,
      );
    } catch (cause) {
      setStatusError(
        signal.aborted
          ? "Updating the order status timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not update the order status.",
      );
    } finally {
      setUpdating(false);
    }
  }

  const primaryAction =
    order?.status === "pending"
      ? { status: "accepted" as const, label: "Accept order" }
      : order?.status === "accepted"
        ? { status: "preparing" as const, label: "Start preparation" }
        : order?.status === "preparing"
          ? { status: "ready" as const, label: "Mark order ready" }
          : order?.status === "ready"
            ? { status: "served" as const, label: "Mark handed off" }
            : order?.status === "served"
              ? { status: "preparing" as const, label: "Reopen for prep" }
              : null;
  const table = order ? tableRecord(order) : null;
  const currentProgress = order ? progressIndex(order.status) : -1;
  const backHref =
    order?.status === "served" || order?.status === "cancelled"
      ? "/kitchen/history"
      : "/kitchen";
  const orderTime = order ? dateTime.format(new Date(order.created_at)) : "";

  return (
    <KitchenWorkspace
      activeCount={activeCount}
      currentView="detail"
      isConnected={order !== null && !loadError}
      onThemeToggle={toggleTheme}
      theme={theme}
      title="Order Details"
    >
      <main className="k-main k-details-page">
        <Link className="k-back" href={backHref}>
          <span aria-hidden="true">←</span>
          Back to {backHref === "/kitchen/history" ? "Order History" : "Dashboard"}
        </Link>

        {themeError && (
          <div className="k-alert" role="alert">
            <span>{themeError}</span>
            <button onClick={clearThemeError} type="button">Dismiss</button>
          </div>
        )}
        {statusError && (
          <div className="k-alert" role="alert">
            <span>{statusError}</span>
            <button onClick={() => setStatusError("")} type="button">Dismiss</button>
          </div>
        )}

        {loading ? (
          <div aria-live="polite" className="k-state">
            <span className="k-state-spinner" />
            Loading ticket details…
          </div>
        ) : loadError ? (
          <div className="k-empty" role="alert">
            <span><KitchenIcon name="refresh" size={28} /></span>
            <h2>Ticket details are unavailable</h2>
            <p>{loadError}</p>
            <button onClick={() => setRetryCount((count) => count + 1)} type="button">
              Try again
            </button>
          </div>
        ) : !order ? (
          <div className="k-empty">
            <span><KitchenIcon name="search" size={28} /></span>
            <h2>Ticket not found</h2>
            <p>This order is not available in the current kitchen order feed.</p>
            <Link href="/kitchen">Return to KDS</Link>
          </div>
        ) : (
          <>
            <section className="k-detail-heading">
              <div>
                <span className="k-eyebrow">ORDER DETAILS</span>
                <h1>Order #{order.id.slice(0, 8).toUpperCase()}</h1>
                <p>
                  {table
                    ? `Table ${table.table_number}${table.name ? ` · ${table.name}` : ""}`
                    : "Table not assigned"}
                  {" · "}Placed {orderTime} · {elapsedTime(order.created_at)} ago
                </p>
              </div>
              <div className="k-detail-identity">
                <span className={`k-status k-status-${displayStatusClass(order.status)}`}>
                  <i />
                  {displayStatus(order.status)}
                </span>
                <div>
                  <small>TABLE</small>
                  <strong>{table?.table_number ?? "—"}</strong>
                </div>
              </div>
            </section>

            <div className="k-detail-grid">
              <section aria-labelledby="k-detail-items-title" className="k-detail-items">
                <div className="k-section-head">
                  <div>
                    <span className="k-eyebrow">KITCHEN TICKET</span>
                    <h2 id="k-detail-items-title">Ordered items</h2>
                  </div>
                  <span>
                    {order.restaurant_order_items.reduce(
                      (sum, item) => sum + item.quantity,
                      0,
                    )}{" "}
                    items
                  </span>
                </div>
                {order.restaurant_order_items.length ? (
                  order.restaurant_order_items.map((item) => {
                    const menuItem = Array.isArray(item.menu_item)
                      ? item.menu_item[0]
                      : item.menu_item;
                    const imageUrl = validImageUrl(menuItem?.image_url ?? "");
                    return (
                      <article className="k-detail-item" key={item.id}>
                        {imageUrl ? (
                          <Image
                            alt=""
                            height={76}
                            src={imageUrl}
                            unoptimized
                            width={92}
                          />
                        ) : (
                          <span aria-hidden="true" className="k-detail-image-placeholder">
                            <KitchenIcon name="plate" size={24} />
                          </span>
                        )}
                        <span className="k-qty">{item.quantity}×</span>
                        <div className="k-detail-item-copy">
                          <h3>{item.item_name}</h3>
                          <p>{currency.format(Number(item.unit_price_inr))} each</p>
                          <p>Spice: {item.spice_level}</p>
                          {item.special_instructions && (
                            <p>Note: {item.special_instructions}</p>
                          )}
                        </div>
                        <strong className="k-detail-item-total">
                          {currency.format(Number(item.line_total_inr))}
                        </strong>
                      </article>
                    );
                  })
                ) : (
                  <div className="k-detail-no-items">
                    No items were recorded on this ticket.
                  </div>
                )}
              </section>

              <aside className="k-progress-panel">
                <span className="k-eyebrow">PREPARATION</span>
                <h2>Order progress</h2>
                {order.status === "cancelled" ? (
                  <div className="k-cancelled-note">
                    <KitchenIcon name="close" />
                    <div>
                      <b>Order cancelled</b>
                      <p>This order is closed and no action is required.</p>
                    </div>
                  </div>
                ) : (
                  <div aria-label="Order progress" className="k-progress">
                    {progressSteps.map((step, index) => (
                      <div
                        className={
                          index < currentProgress
                            ? "complete"
                            : index === currentProgress
                              ? "current"
                              : ""
                        }
                        key={step}
                      >
                        <i>
                          {index < currentProgress ? (
                            <KitchenIcon name="check" size={14} />
                          ) : (
                            index + 1
                          )}
                        </i>
                        <span />
                        <div>
                          <b>{step}</b>
                          {index === currentProgress && <small>Current status</small>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="k-order-summary">
                  <span>ORDER TOTAL</span>
                  <strong>{currency.format(Number(order.total_inr))}</strong>
                  {table?.name && <small>{table.name}</small>}
                </div>

                {order.status === "pending" && canCancel && (
                  <button
                    className="k-secondary-action k-detail-pass"
                    disabled={updating}
                    onClick={() => void updateStatus("cancelled")}
                    type="button"
                  >
                    86 / Pass
                  </button>
                )}
                {primaryAction && (
                  <button
                    className="k-primary-action k-detail-action"
                    disabled={updating}
                    onClick={() => {
                      if (primaryAction.status === "served") {
                        setConfirmServe(true);
                      } else {
                        void updateStatus(primaryAction.status);
                      }
                    }}
                    type="button"
                  >
                    {updating ? "Saving…" : primaryAction.label}
                    <KitchenIcon name="arrow" size={16} />
                  </button>
                )}
                {!primaryAction && order.status === "cancelled" && (
                  <span className="k-detail-closed">No further action required</span>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
      {confirmServe && order && (
        <KitchenConfirmationDialog
          busy={updating}
          onCancel={() => setConfirmServe(false)}
          onConfirm={() => {
            setConfirmServe(false);
            void updateStatus("served");
          }}
          orderLabel={`Order #${order.id.slice(0, 8).toUpperCase()}`}
        />
      )}
    </KitchenWorkspace>
  );
}
