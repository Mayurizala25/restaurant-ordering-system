"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type InvoiceItem = {
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

type InvoiceOrder = {
  orderNumber: string;
  status: "pending" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
  createdAt: string;
  customerName: string;
  total: number;
  tableNumber: number;
  items: InvoiceItem[];
};

type PrintBridgeWindow = Window & {
  ReactNativeWebView?: { postMessage: (message: string) => void };
};

const ORDER_STATUSES: InvoiceOrder["status"][] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
];
const STATUS_LABELS: Record<InvoiceOrder["status"], string> = {
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
const formatDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const nativePrintStyles = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #24231f; background: #fff; font: 14px Arial, sans-serif; }
  .vr-invoice-document { max-width: 760px; margin: 0 auto; border: 1px solid #e6e1d8; border-radius: 16px; padding: 32px; }
  .vr-invoice-brand { text-align: center; border-bottom: 1px solid #e6e1d8; padding-bottom: 20px; }
  .vr-invoice-logo { width: 82px; height: auto; margin: 0 auto 10px; }
  .vr-invoice-brand h2 { margin: 0; font: 700 25px Georgia, serif; }
  .vr-invoice-brand p { margin: 5px 0 0; color: #6e6a62; font-size: 11px; letter-spacing: .12em; }
  .vr-invoice-state { display: inline-block; margin-top: 14px; border-radius: 99px; background: #e5ece4; padding: 7px 14px; color: #526a56; font-size: 11px; font-weight: 700; }
  .vr-invoice-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; border-radius: 12px; background: #f5f3ed; padding: 16px; }
  .vr-invoice-meta div { min-width: 0; }
  .vr-invoice-meta dt { margin-bottom: 4px; color: #716b63; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .vr-invoice-meta dd { margin: 0; overflow-wrap: anywhere; font-size: 12px; font-weight: 600; }
  .vr-invoice-items { width: 100%; border-collapse: collapse; }
  .vr-invoice-items th { border-bottom: 1px solid #dcd7ce; padding: 8px 4px; color: #716b63; font-size: 10px; text-align: left; text-transform: uppercase; }
  .vr-invoice-items th:last-child, .vr-invoice-items td:last-child { text-align: right; }
  .vr-invoice-items td { border-bottom: 1px solid #eeeae2; padding: 12px 4px; vertical-align: top; }
  .vr-invoice-item-name { display: block; font-weight: 700; }
  .vr-invoice-item-detail { display: block; margin-top: 4px; color: #716b63; font-size: 11px; }
  .vr-invoice-total { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; border-radius: 12px; background: #f5f3ed; padding: 17px; font-weight: 700; }
  .vr-invoice-total strong { color: #984b20; font-size: 22px; }
  .vr-invoice-thanks { margin: 22px 0 0; color: #6e6a62; font: italic 16px Georgia, serif; text-align: center; }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvoiceOrder(value: unknown): value is InvoiceOrder {
  return (
    isRecord(value) &&
    typeof value.orderNumber === "string" &&
    value.orderNumber.length > 0 &&
    typeof value.status === "string" &&
    ORDER_STATUSES.includes(value.status as InvoiceOrder["status"]) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.customerName === "string" &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    value.total >= 0 &&
    typeof value.tableNumber === "number" &&
    Number.isSafeInteger(value.tableNumber) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.unitPrice === "number" &&
        Number.isFinite(item.unitPrice) &&
        item.unitPrice >= 0 &&
        typeof item.quantity === "number" &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        typeof item.lineTotal === "number" &&
        Number.isFinite(item.lineTotal) &&
        item.lineTotal >= 0,
    )
  );
}

export default function InvoiceClient({
  token,
  autoPrint,
}: {
  token: string;
  autoPrint: boolean;
}) {
  const [order, setOrder] = useState<InvoiceOrder | null>(null);
  const [error, setError] = useState("");
  const [printError, setPrintError] = useState("");
  const autoPrintStarted = useRef(false);

  useEffect(() => {
    let active = true;
    const loadInvoice = async () => {
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
        if (
          !response.ok ||
          !isRecord(payload) ||
          !isInvoiceOrder(payload.order)
        ) {
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Invoice details could not be verified.",
          );
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
              : "Invoice details could not be loaded.",
          );
        }
      }
    };

    void loadInvoice();
    return () => {
      active = false;
    };
  }, [token]);

  const printInvoice = useCallback(() => {
    const invoice = document.getElementById("vr-invoice-print-document");
    if (!invoice) {
      setPrintError("Invoice is not ready to print.");
      return;
    }

    const invoiceMarkup = invoice.outerHTML.replace(
      /\bsrc="([^"]+)"/g,
      (_match, source: string) =>
        `src="${new URL(source, window.location.href).href}"`,
    );
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Virtual Rudra Order Invoice</title><style>${nativePrintStyles}</style></head><body>${invoiceMarkup}</body></html>`;
    const bridge = (window as PrintBridgeWindow).ReactNativeWebView;
    if (bridge) {
      bridge.postMessage(
        JSON.stringify({ type: "virtual-rudra:print-invoice", html }),
      );
      setPrintError("");
      return;
    }
    if (typeof window.print !== "function") {
      setPrintError("Printing is not available in this browser.");
      return;
    }
    setPrintError("");
    window.print();
  }, []);

  useEffect(() => {
    if (!autoPrint || !order || autoPrintStarted.current) return;
    autoPrintStarted.current = true;
    const timer = window.setTimeout(printInvoice, 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint, order, printInvoice]);

  return (
    <main className="vr-menu-page vr-invoice-page" data-customer-theme="dark">
      <div className="vr-menu-shell">
        <header className="vr-invoice-toolbar">
          <Link href="/thank-you">← Back</Link>
          <h1>Order Invoice</h1>
          <button disabled={!order} onClick={printInvoice} type="button">
            Download / Print
          </button>
        </header>
        {error ? (
          <section aria-live="polite" className="vr-invoice-message" role="alert">
            <h2>Invoice unavailable</h2>
            <p>{error}</p>
            <Link href="/thank-you">Back to Order Confirmation</Link>
          </section>
        ) : !order ? (
          <p aria-live="polite" className="vr-menu-message" role="status">
            Loading verified invoice details…
          </p>
        ) : (
          <>
            <article
              className="vr-invoice-document"
              id="vr-invoice-print-document"
            >
              <header className="vr-invoice-brand">
                <Image
                  alt="Virtual Rudra"
                  className="vr-invoice-logo"
                  height={403}
                  src="/brand/virtual-rudra-logo.png?v=2"
                  unoptimized
                  width={587}
                />
                <h2>Virtual Rudra</h2>
                <p>RESTAURANT &amp; KITCHEN</p>
                <span className="vr-invoice-state">
                  ORDER {STATUS_LABELS[order.status].toUpperCase()}
                </span>
              </header>
              <dl className="vr-invoice-meta">
                <div>
                  <dt>Order reference</dt>
                  <dd>{order.orderNumber}</dd>
                </div>
                <div>
                  <dt>Date &amp; time</dt>
                  <dd>{formatDateTime.format(new Date(order.createdAt))}</dd>
                </div>
                <div>
                  <dt>Seating</dt>
                  <dd>Table #{order.tableNumber}</dd>
                </div>
                <div>
                  <dt>Guest</dt>
                  <dd>{order.customerName}</dd>
                </div>
              </dl>
              <table className="vr-invoice-items">
                <thead>
                  <tr>
                    <th scope="col">Course / Item</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, index) => (
                    <tr key={`${item.name}-${index}`}>
                      <td>
                        <span className="vr-invoice-item-name">
                          {item.quantity}× {item.name}
                        </span>
                        <span className="vr-invoice-item-detail">
                          {formatINR.format(item.unitPrice)} each
                        </span>
                      </td>
                      <td>{formatINR.format(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="vr-invoice-total">
                <span>Order Total</span>
                <strong>{formatINR.format(order.total)}</strong>
              </div>
              <p className="vr-invoice-thanks">
                Thank you for ordering with Virtual Rudra.
              </p>
            </article>
            <footer className="vr-invoice-footer">
              <Link href="/thank-you">← Back to Order Confirmation</Link>
              <span>Virtual Rudra · Order receipt</span>
            </footer>
          </>
        )}
        {printError && (
          <p className="vr-invoice-print-error" role="alert">
            {printError}
          </p>
        )}
      </div>
    </main>
  );
}
