"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type TrackedOrder = {
  orderNumber: string;
  status: "pending" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
  total: number;
  tableNumber: number;
  items: { name: string; unitPrice: number; quantity: number; lineTotal: number }[];
};

const ORDER_STATUSES: TrackedOrder["status"][] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
];
const STATUS_LABELS: Record<TrackedOrder["status"], string> = {
  pending: "Received",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
};
const formatINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrackedOrder(value: unknown): value is TrackedOrder {
  return (
    isRecord(value) &&
    typeof value.orderNumber === "string" &&
    typeof value.status === "string" &&
    ORDER_STATUSES.includes(value.status as TrackedOrder["status"]) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    value.total >= 0 &&
    typeof value.tableNumber === "number" &&
    Number.isSafeInteger(value.tableNumber) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.unitPrice === "number" &&
        Number.isFinite(item.unitPrice) &&
        typeof item.quantity === "number" &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        typeof item.lineTotal === "number" &&
        Number.isFinite(item.lineTotal),
    )
  );
}

export default function OrderTrackingClient({ token }: { token: string }) {
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/orders/track", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          if (active) {
            setError(
              isRecord(payload) && typeof payload.error === "string"
                ? payload.error
                : "Could not load this order's status.",
            );
          }
          return;
        }
        if (!isRecord(payload) || !isTrackedOrder(payload.order)) {
          throw new Error("Order tracking data could not be read.");
        }
        if (active) {
          setOrder(payload.order);
          setError("");
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load this order's status.",
          );
        }
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

  const statusLabel = order ? STATUS_LABELS[order.status] : "";
  const isTerminal = order?.status === "served" || order?.status === "cancelled";

  return (
    <main className="vr-menu-page">
      <div className="vr-menu-shell">
        <header className="vr-menu-header">
          <Link aria-label="Virtual Rudra menu home" className="vr-menu-brand" href="/menu">
            <Image
              alt=""
              className="vr-menu-brand-mark"
              height={42}
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={56}
            />
            <span>
              <strong>Virtual Rudra</strong>
              <small>RESTAURANT &amp; KITCHEN</small>
            </span>
          </Link>
          <span className="vr-menu-header-note">
            <i aria-hidden="true" />
            Order tracking
          </span>
        </header>

        <section aria-labelledby="tracking-title" className="vr-menu-confirmation">
          <p className="vr-menu-category-kicker">ORDER TRACKING</p>
          <h1 id="tracking-title" className="text-2xl font-bold">
            {order ? `Order ${order.orderNumber}` : "Track your order"}
          </h1>
          {order ? (
            <>
              <p className="vr-menu-confirmation-message">
                Current status: <strong>{statusLabel}</strong>
                {!isTerminal && " · Updates automatically"}
              </p>
              <dl className="vr-menu-confirmation-details">
                <div>
                  <dt>Status</dt>
                  <dd aria-live="polite">{statusLabel}</dd>
                </div>
                <div>
                  <dt>Table</dt>
                  <dd>Table {order.tableNumber}</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{formatINR.format(order.total)}</dd>
                </div>
              </dl>
              <div className="vr-menu-checkout-summary">
                <h2>Items</h2>
                <ul>
                  {order.items.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          Qty {item.quantity} × {formatINR.format(item.unitPrice)}
                        </small>
                      </span>
                      <strong>{formatINR.format(item.lineTotal)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              {error && <p className="vr-menu-checkout-message" role="alert">{error}</p>}
            </>
          ) : (
            <p aria-live="polite" className="vr-menu-confirmation-message" role="status">
              {error || "Loading your order…"}
            </p>
          )}
          {order && (
            <ol aria-label="Order progress" className="mt-6 grid gap-2 text-sm sm:grid-cols-5">
              {(["pending", "accepted", "preparing", "ready", "served"] as const).map(
                (status) => {
                  const currentIndex = ORDER_STATUSES.indexOf(order.status);
                  const stepIndex = ORDER_STATUSES.indexOf(status);
                  const reached =
                    order.status !== "cancelled" && currentIndex >= stepIndex;
                  return (
                    <li
                      aria-current={order.status === status ? "step" : undefined}
                      className={`rounded-lg border px-3 py-2 ${
                        reached
                          ? "border-[#f97316] bg-[#2c211b] text-[#ff9a4d]"
                          : "border-[#30343d] text-[#9299a6]"
                      }`}
                      key={status}
                    >
                      {STATUS_LABELS[status]}
                    </li>
                  );
                },
              )}
              {order.status === "cancelled" && (
                <li className="rounded-lg border border-[#a3423c] bg-[#2b1f20] px-3 py-2 text-[#ff958a]">
                  Cancelled
                </li>
              )}
            </ol>
          )}
          <Link className="vr-menu-place-order mt-6" href="/menu">
            Back to Menu
          </Link>
        </section>
      </div>
    </main>
  );
}
