"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import type { DemoTable } from "../_lib/demo-data";
import { AdminPageHeading } from "../_components/admin-page";
import {
  createTimeoutSignal,
  fetchJsonWithTimeout,
  RequestTimeoutError,
} from "../_lib/request-timeout";
import { SITE_URL } from "../../../mobile/qr";

type TableForm = {
  tableNumber: string;
  name: string;
  seatingCapacity: string;
  isActive: boolean;
};
type TableStatusFilter = "all" | "active" | "inactive";

const EMPTY_FORM: TableForm = {
  tableNumber: "",
  name: "",
  seatingCapacity: "2",
  isActive: true,
};
const EMPTY_TABLES: DemoTable[] = [];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-border bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTable(value: unknown): value is DemoTable {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.tableNumber === "number" &&
    Number.isSafeInteger(value.tableNumber) &&
    value.tableNumber > 0 &&
    value.tableNumber <= 2_147_483_647 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 60 &&
    typeof value.seatingCapacity === "number" &&
    Number.isSafeInteger(value.seatingCapacity) &&
    value.seatingCapacity > 0 &&
    value.seatingCapacity <= 2_147_483_647 &&
    typeof value.isActive === "boolean"
  );
}

async function readApiResponse(response: Response) {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The table service returned an unreadable response.");
  }
  return readApiPayload(response, payload);
}

function readApiPayload(response: Response, payload: unknown) {
  if (!response.ok) {
    throw new Error(
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "The table request could not be completed.",
    );
  }
  if (!isRecord(payload)) {
    throw new Error("The table service returned invalid data.");
  }
  return payload;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function buildQrPrintDocument(table: DemoTable, qrImage: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qrImage)) {
    throw new Error("The generated QR image is not a valid PNG.");
  }
  const tableNumber = String(table.tableNumber);
  const tableName = escapeHtml(table.name);
  const image = escapeHtml(qrImage);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Virtual Rudra · Table ${tableNumber}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 273mm; margin: 0; }
    body { display: grid; place-items: center; background: #fff; color: #16201d; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .vr-table-qr-print { width: 116mm; margin: auto; overflow: hidden; border: .4mm solid #deddd6; border-radius: 5mm; background: #fffefb; padding: 8mm; color: #16201d; break-inside: avoid; page-break-inside: avoid; }
    .vr-table-qr-print-brand { display: flex; align-items: center; gap: 3mm; }
    .vr-table-qr-print-mark { display: grid; width: 12mm; height: 12mm; flex: none; place-items: center; border-radius: 3mm; background: #c26d3a; color: #fff; font-size: 13pt; font-weight: 800; }
    .vr-table-qr-print-brand-copy { display: grid; gap: 1mm; }
    .vr-table-qr-print-brand-copy strong { color: #16201d; font-size: 11pt; line-height: 1.2; }
    .vr-table-qr-print-brand-copy span, .vr-table-qr-print-number { color: #6e7671; font-size: 7pt; font-weight: 700; letter-spacing: .1em; }
    .vr-table-qr-print-number { margin-left: auto; border-radius: 99px; background: #f5f3ed; padding: 2mm 3mm; color: #984b20; }
    .vr-table-qr-print-heading { margin-top: 7mm; text-align: center; }
    .vr-table-qr-print-label { margin: 0; color: #a95b2e; font-size: 7pt; font-weight: 800; letter-spacing: .14em; }
    .vr-table-qr-print-heading h3 { margin: 2mm 0 0; color: #16201d; font-family: Georgia, "Times New Roman", serif; font-size: 21pt; line-height: 1.15; overflow-wrap: anywhere; }
    .vr-table-qr-print-heading > p:last-child { margin: 2mm 0 0; color: #6e7671; font-size: 9pt; }
    .vr-table-qr-code-frame { display: grid; width: 90mm; height: 90mm; place-items: center; margin: 7mm auto 4mm; border: .3mm solid #eee9df; border-radius: 4mm; background: #fff; padding: 2mm; }
    .vr-table-qr-image { display: block; width: 82mm; height: 82mm; object-fit: contain; image-rendering: pixelated; }
    .vr-table-qr-print-hint { margin: 0; color: #6e7671; font-size: 8pt; line-height: 1.45; text-align: center; }
    .vr-table-qr-print-footer { display: flex; justify-content: space-between; gap: 3mm; margin-top: 6mm; border-top: .3mm solid #e8e2d9; padding-top: 3mm; color: #6e7671; font-size: 6.5pt; font-weight: 750; letter-spacing: .12em; }
  </style>
</head>
<body>
  <main class="vr-table-qr-print">
    <div class="vr-table-qr-print-brand">
      <span class="vr-table-qr-print-mark">VR</span>
      <div class="vr-table-qr-print-brand-copy"><strong>Virtual Rudra</strong><span>TABLE MENU</span></div>
      <span class="vr-table-qr-print-number">T-${String(table.tableNumber).padStart(2, "0")}</span>
    </div>
    <div class="vr-table-qr-print-heading">
      <p class="vr-table-qr-print-label">SCAN TO VIEW OUR MENU</p>
      <h3>${tableName}</h3>
      <p>Table ${tableNumber} · Scan to explore the menu</p>
    </div>
    <div class="vr-table-qr-code-frame">
      <img class="vr-table-qr-image" src="${image}" alt="QR code for table ${tableNumber}">
    </div>
    <p class="vr-table-qr-print-hint">Point your phone camera at the code to open the menu.</p>
    <div class="vr-table-qr-print-footer"><span>VIRTUAL RUDRA</span><span>TABLE ${tableNumber}</span></div>
  </main>
</body>
</html>`;
}

export default function AdminTablesClient() {
  const [data, setData] = useState<DemoTable[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TableStatusFilter>("all");
  const [dialog, setDialog] = useState<"form" | "delete" | "qr" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DemoTable | null>(null);
  const [qrTable, setQrTable] = useState<DemoTable | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [qrDownloadError, setQrDownloadError] = useState("");
  const [qrPrintError, setQrPrintError] = useState("");
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [form, setForm] = useState<TableForm>(EMPTY_FORM);
  const requestId = useRef(0);
  const loadInFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);

  const refreshData = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const currentRequestId = ++requestId.current;
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const { response, payload: responsePayload } = await fetchJsonWithTimeout(
        "/api/admin/tables",
        { cache: "no-store", signal: controller.signal },
        15_000,
      );
      const payload = readApiPayload(response, responsePayload);
      if (!Array.isArray(payload.tables) || !payload.tables.every(isTable)) {
        throw new Error("The table service returned invalid table data.");
      }
      if (currentRequestId !== requestId.current) return;
      setData(payload.tables);
      setLoadError("");
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setLoadError(
        cause instanceof RequestTimeoutError
          ? "Loading restaurant tables timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not load restaurant tables.",
      );
    } finally {
      loadInFlight.current = false;
      if (loadController.current === controller) loadController.current = null;
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshData(), 0);
    const handleFocus = () => void refreshData();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshData();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    window.addEventListener("virtual-rudra:refresh", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
      loadController.current?.abort();
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
      window.removeEventListener("virtual-rudra:refresh", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshData]);

  useEffect(() => {
    if (!dialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [dialog]);

  useEffect(() => {
    if (dialog !== "qr" || !qrUrl) return;
    let active = true;
    async function generateQr() {
      try {
        const image = await QRCode.toDataURL(qrUrl, {
          errorCorrectionLevel: "Q",
          margin: 4,
          width: 1024,
          color: { dark: "#111318", light: "#ffffff" },
        });
        if (active) setQrImage(image);
      } catch (cause) {
        if (active) {
          setQrError(
            cause instanceof Error ? cause.message : "Could not generate this QR code.",
          );
        }
      }
    }

    void generateQr();

    return () => {
      active = false;
    };
  }, [dialog, qrUrl]);

  const tables = data ?? EMPTY_TABLES;
  const activeCount = tables.filter((table) => table.isActive).length;
  const inactiveCount = tables.length - activeCount;
  const seatingCapacity = tables.reduce((total, table) => total + table.seatingCapacity, 0);
  const filteredTables = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tables
      .filter(
        (table) =>
          (statusFilter === "all" ||
            table.isActive === (statusFilter === "active")) &&
          (String(table.tableNumber).includes(query) ||
            table.name.toLowerCase().includes(query) ||
            `${table.seatingCapacity} seats`.includes(query)),
      )
      .toSorted((left, right) => left.tableNumber - right.tableNumber);
  }, [search, statusFilter, tables]);

  function closeDialog() {
    setDialog(null);
    setActionError("");
    setPendingDelete(null);
    setQrTable(null);
  }

  function openQrDialog(table: DemoTable) {
    const tableId = typeof table.id === "string" ? table.id.trim() : "";
    setQrTable(table);
    setQrImage("");
    if (UUID_PATTERN.test(tableId)) {
      try {
        const configuredOrigin = process.env.NEXT_PUBLIC_MENU_ORIGIN?.trim();
        const menuUrl = new URL(
          process.env.NODE_ENV === "production"
            ? SITE_URL
            : configuredOrigin || window.location.origin,
        );
        const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(
          menuUrl.hostname,
        );
        if (!configuredOrigin && isLoopback) {
          const lanHost = process.env.NEXT_PUBLIC_DEV_LAN_HOST?.trim();
          if (lanHost) {
            menuUrl.hostname = lanHost;
          } else {
            const fallbackUrl = new URL(SITE_URL);
            menuUrl.protocol = fallbackUrl.protocol;
            menuUrl.host = fallbackUrl.host;
          }
        }
        if (
          !["http:", "https:"].includes(menuUrl.protocol) ||
          menuUrl.username ||
          menuUrl.password ||
          (process.env.NODE_ENV === "production" && menuUrl.protocol !== "https:")
        ) {
          throw new Error("The menu origin must be a secure, reachable web address.");
        }
        menuUrl.pathname = "/menu";
        menuUrl.search = "";
        menuUrl.searchParams.set("tableId", tableId);
        menuUrl.searchParams.set("tableNumber", String(table.tableNumber));
        setQrUrl(menuUrl.toString());
        setQrError("");
      } catch (cause) {
        setQrUrl("");
        setQrError(
          cause instanceof Error
            ? cause.message
            : "Could not create a phone-accessible menu URL.",
        );
      }
    } else {
      setQrUrl("");
      setQrError("This table has no valid ID, so a QR code cannot be generated.");
    }
    setQrDownloadError("");
    setQrPrintError("");
    setFeedback("");
    setDialog("qr");
  }

  async function downloadQr() {
    setQrDownloadError("");
    if (!qrImage || !qrTable) {
      setQrDownloadError("The QR code is not ready to download yet.");
      return;
    }

    setDownloadingQr(true);
    try {
      const [metadata, encoded] = qrImage.split(",", 2);
      if (metadata !== "data:image/png;base64" || !encoded) {
        throw new Error("The generated QR image is not a valid PNG.");
      }

      const binary = window.atob(encoded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const objectUrl = URL.createObjectURL(
        new Blob([bytes], { type: "image/png" }),
      );
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `virtual-rudra-table-${qrTable.tableNumber}-qr.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (cause) {
      setQrDownloadError(
        cause instanceof Error
          ? `Could not download the QR code: ${cause.message}`
          : "Could not download the QR code. Please try again.",
      );
    } finally {
      setDownloadingQr(false);
    }
  }

  function printQrCard() {
    if (!qrImage || !qrTable) return;
    setQrPrintError("");
    try {
      const html = buildQrPrintDocument(qrTable, qrImage);
      const bridge = (
        window as Window & {
          ReactNativeWebView?: { postMessage: (message: string) => void };
        }
      ).ReactNativeWebView;
      if (bridge) {
        bridge.postMessage(
          JSON.stringify({ type: "virtual-rudra:print-table-qr", html }),
        );
      } else {
        window.print();
      }
    } catch (cause) {
      setQrPrintError(
        cause instanceof Error
          ? `Could not prepare the QR card for printing: ${cause.message}`
          : "Could not prepare the QR card for printing.",
      );
    }
  }

  function openAddDialog() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      tableNumber: String(Math.max(0, ...tables.map((table) => table.tableNumber)) + 1),
    });
    setActionError("");
    setFeedback("");
    setDialog("form");
  }

  function openEditDialog(table: DemoTable) {
    setEditingId(table.id);
    setForm({
      tableNumber: String(table.tableNumber),
      name: table.name,
      seatingCapacity: String(table.seatingCapacity),
      isActive: table.isActive,
    });
    setActionError("");
    setFeedback("");
    setDialog("form");
  }

  async function saveTable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    setFeedback("");

    if (!data) {
      setActionError("Table data is not available. Reload the page and try again.");
      return;
    }

    const name = form.name.trim();
    const tableNumber = Number(form.tableNumber);
    const seatingCapacity = Number(form.seatingCapacity);
    if (
      !/^\d+$/.test(form.tableNumber) ||
      !Number.isSafeInteger(tableNumber) ||
      tableNumber < 1 ||
      tableNumber > 2_147_483_647
    ) {
      setActionError("Enter a whole table number between 1 and 2,147,483,647.");
      return;
    }
    if (!name) {
      setActionError("Enter a table name.");
      return;
    }
    if (name.length > 60) {
      setActionError("Table names must be 60 characters or fewer.");
      return;
    }
    if (
      !/^\d+$/.test(form.seatingCapacity) ||
      !Number.isSafeInteger(seatingCapacity) ||
      seatingCapacity < 1 ||
      seatingCapacity > 2_147_483_647
    ) {
      setActionError("Seating capacity must be between 1 and 2,147,483,647.");
      return;
    }
    if (
      tables.some(
        (table) =>
          table.id !== editingId && table.tableNumber === tableNumber,
      )
    ) {
      setActionError(`Table number ${tableNumber} is already in use.`);
      return;
    }

    const existing = tables.find((table) => table.id === editingId);
    if (editingId && !existing) {
      setActionError("This table could not be found. Refresh the page and try again.");
      return;
    }
    requestId.current += 1;
    setIsMutating(true);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch(
        existing
          ? `/api/admin/tables?id=${encodeURIComponent(existing.id)}`
          : "/api/admin/tables",
        {
          method: existing ? "PATCH" : "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableNumber,
            name,
            seatingCapacity,
            isActive: form.isActive,
          }),
          signal,
        },
      );
      const payload = await readApiResponse(response);
      if (!isTable(payload.table)) {
        throw new Error("The saved table could not be verified.");
      }
      const updatedTable = payload.table;
      setData((current) => {
        const currentTables = current ?? [];
        return existing
          ? currentTables.map((table) =>
              table.id === existing.id ? updatedTable : table,
            )
          : [...currentTables, updatedTable];
      });
      setDialog(null);
      setFeedback(
        existing
          ? `Table ${tableNumber} was updated.`
          : `Table ${tableNumber} was added.`,
      );
    } catch (cause) {
      setActionError(
        signal.aborted
          ? "Saving the table timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not save this table.",
      );
    } finally {
      setIsMutating(false);
    }
  }

  function requestDelete(table: DemoTable) {
    setPendingDelete(table);
    setActionError("");
    setFeedback("");
    setDialog("delete");
  }

  async function deleteTable() {
    if (!data || !pendingDelete) {
      setActionError("Table data is not available. Reload the page and try again.");
      return;
    }

    const table = data.find((entry) => entry.id === pendingDelete.id);
    if (!table) {
      setActionError("This table could not be found. Refresh the page and try again.");
      return;
    }
    requestId.current += 1;
    setIsMutating(true);
    const signal = createTimeoutSignal(20_000);
    try {
      const response = await fetch(
        `/api/admin/tables?id=${encodeURIComponent(table.id)}`,
        { method: "DELETE", cache: "no-store", signal },
      );
      await readApiResponse(response);
      setData((current) =>
        (current ?? []).filter((entry) => entry.id !== table.id),
      );
      setDialog(null);
      setPendingDelete(null);
      setFeedback(`Table ${table.tableNumber} was deleted.`);
    } catch (cause) {
      setActionError(
        signal.aborted
          ? "Deleting the table timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not delete this table.",
      );
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <main className="vr-admin-tables-page vr-admin-management-page mx-auto w-full max-w-[1450px] px-5 py-7 sm:px-8 sm:py-9 md:px-10">
      <AdminPageHeading
        description="Manage your dining spaces, seating, and table availability."
        eyebrow="FLOOR MANAGEMENT"
        title="Tables Management"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-3 text-xs font-semibold text-muted">
            {data ? `${tables.length} Registered` : "Loading"}
          </span>
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(249,115,22,0.16)] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!data}
            onClick={openAddDialog}
            type="button"
          >
            <Icon name="plus" />
            Add new table
          </button>
        </div>
      </AdminPageHeading>

      <section
        aria-label="Table summary"
        className="vr-admin-table-summary mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        <SummaryCard
          label="Total tables"
          value={data ? String(tables.length).padStart(2, "0") : "—"}
          detail="Across your restaurant"
          icon="tables"
        />
        <SummaryCard
          label="Total seats"
          value={data ? String(seatingCapacity).padStart(2, "0") : "—"}
          detail="Configured capacity"
          icon="seats"
        />
        <SummaryCard
          label="Active"
          value={data ? String(activeCount).padStart(2, "0") : "—"}
          detail="Available for service"
          icon="check"
        />
        <SummaryCard
          label="Inactive"
          value={data ? String(inactiveCount).padStart(2, "0") : "—"}
          detail="Not in service"
          icon="pause"
        />
      </section>

      {(loadError || actionError || feedback) && (
        <div
          aria-live="polite"
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
            loadError || actionError
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-sage/30 bg-sage-soft text-sage"
          }`}
          role={loadError || actionError ? "alert" : "status"}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>{loadError || actionError || feedback}</p>
            {loadError && (
              <button
                className="text-xs font-semibold text-accent hover:underline"
                onClick={() =>
                  window.dispatchEvent(new Event("virtual-rudra:refresh"))
                }
                type="button"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      <section
        aria-label="Restaurant tables"
        aria-busy={loading}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_48px_rgba(0,0,0,0.08)]"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-[var(--text)]">Dining tables</h2>
              <p className="mt-1 text-xs text-muted">
                {data
                  ? `${filteredTables.length} of ${tables.length} ${
                      tables.length === 1 ? "table" : "tables"
                    }`
                  : loadError
                    ? "Saved table data is unavailable."
                    : "Loading saved tables…"}
              </p>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Search tables</span>
              <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted">
                <Icon name="search" />
              </span>
              <input
                className="h-10 w-full rounded-xl border border-border bg-[var(--bg)] pl-10 pr-3 text-sm text-[var(--text)] outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search table, number, or seats"
                type="search"
                value={search}
              />
            </label>
          </div>
          <div
            aria-label="Filter tables by status"
            className="mt-4 flex gap-2 overflow-x-auto pb-1"
            role="group"
          >
            {(["all", "active", "inactive"] as const).map((filter) => {
              const label =
                filter === "all"
                  ? "All tables"
                  : filter === "active"
                    ? "Active"
                    : "Inactive";
              const count =
                !data
                  ? "—"
                  : filter === "all"
                    ? tables.length
                    : filter === "active"
                      ? activeCount
                      : inactiveCount;
              return (
                <button
                  aria-pressed={statusFilter === filter}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                    statusFilter === filter
                      ? "border-accent bg-accent text-white"
                      : "border-border bg-surface text-muted hover:bg-surface-2"
                  }`}
                  disabled={!data}
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  type="button"
                >
                  {label}
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {!data ? (
          <div className="px-6 py-14 text-center text-sm text-muted">
            {loadError ? "Saved table data could not be loaded." : "Loading tables…"}
          </div>
        ) : filteredTables.length ? (
          <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-2 xl:grid-cols-3">
            {filteredTables.map((table) => (
              <article
                className="vr-admin-table-card flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition hover:border-accent sm:p-5"
                key={table.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-serif text-lg font-semibold leading-tight text-[var(--text)]">
                      {table.name}
                    </h3>
                    <p className="mt-1.5 text-xs text-muted">
                      Table {table.tableNumber}
                    </p>
                  </div>
                  <span className="inline-flex h-7 shrink-0 items-center rounded-lg border border-border bg-surface-2 px-2 text-[11px] font-semibold text-accent">
                    T-{String(table.tableNumber).padStart(2, "0")}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <StatusBadge isActive={table.isActive} />
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <Icon name="seats" />
                    {table.seatingCapacity}{" "}
                    {table.seatingCapacity === 1 ? "seat" : "seats"}
                  </span>
                </div>

                <div className="vr-admin-table-card-actions mt-4 grid grid-cols-[minmax(0,1fr)_40px_40px] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <button
                    aria-label={`Show QR code for table ${table.tableNumber}`}
                    className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-2 text-xs font-medium text-accent transition hover:border-accent hover:bg-surface sm:h-9 sm:px-3"
                    onClick={() => openQrDialog(table)}
                    type="button"
                  >
                    <Icon name="qr" />
                    QR code
                  </button>
                  <button
                    aria-label={`Edit table ${table.tableNumber}, ${table.name}`}
                    className="inline-flex size-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface text-xs font-medium text-[var(--text)] transition hover:border-accent hover:text-accent sm:h-9 sm:w-auto sm:px-3"
                    onClick={() => openEditDialog(table)}
                    type="button"
                  >
                    <Icon name="edit" />
                    <span className="sr-only sm:not-sr-only">Edit</span>
                  </button>
                  <button
                    aria-label={`Delete table ${table.tableNumber}, ${table.name}`}
                    className="inline-flex size-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface text-xs font-medium text-danger transition hover:border-danger hover:bg-danger/10 sm:h-9 sm:w-auto sm:px-3"
                    onClick={() => requestDelete(table)}
                    type="button"
                  >
                    <Icon name="trash" />
                    <span className="sr-only sm:not-sr-only">Delete</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-border bg-surface-2 text-muted">
              <Icon name="search" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-[var(--text)]">
              {tables.length ? "No tables match these filters" : "No tables yet"}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {tables.length
                ? "Adjust the search or choose a different status."
                : "Add a table to start managing your dining spaces."}
            </p>
            {!tables.length && (
              <button
                className="mt-4 text-sm font-semibold text-accent hover:text-accent-hover"
                onClick={openAddDialog}
                type="button"
              >
                Add your first table
              </button>
            )}
          </div>
        )}
      </section>

      {dialog === "form" && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-labelledby="table-dialog-title"
            aria-modal="true"
            className="my-auto w-full max-w-lg rounded-2xl border border-border bg-surface p-5 text-[var(--text)] shadow-2xl sm:p-6"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold tracking-[0.16em] text-accent">
                  TABLE DETAILS
                </p>
                <h2
                  className="mt-2 text-lg font-bold text-[var(--text)]"
                  id="table-dialog-title"
                >
                  {editingId ? "Edit table" : "Add a table"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Add the number, name, and seating details.
                </p>
              </div>
              <button
                aria-label="Close dialog"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-[var(--text)]"
                onClick={closeDialog}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>

            <form className="mt-6" onSubmit={saveTable}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-medium text-muted">
                  Table number
                  <input
                    autoFocus
                    className={inputClass}
                    inputMode="numeric"
                    max={2_147_483_647}
                    min="1"
                    onChange={(event) => {
                      setForm({ ...form, tableNumber: event.target.value });
                      setActionError("");
                    }}
                    placeholder="e.g. 12"
                    required
                    type="number"
                    value={form.tableNumber}
                  />
                </label>
                <label className="text-xs font-medium text-muted">
                  Seating capacity
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    max={2_147_483_647}
                    min="1"
                    onChange={(event) => {
                      setForm({ ...form, seatingCapacity: event.target.value });
                      setActionError("");
                    }}
                    placeholder="e.g. 4"
                    required
                    type="number"
                    value={form.seatingCapacity}
                  />
                </label>
              </div>
              <label className="mt-4 block text-xs font-medium text-muted">
                Table name
                <input
                  className={inputClass}
                  maxLength={60}
                  onChange={(event) => {
                    setForm({ ...form, name: event.target.value });
                    setActionError("");
                  }}
                  placeholder="e.g. Garden view"
                  required
                  type="text"
                  value={form.name}
                />
              </label>
              <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
                <span>
                  <span className="block text-sm font-medium text-[var(--text)]">
                    Active for service
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    Inactive tables are not available for seating.
                  </span>
                </span>
                <input
                  checked={form.isActive}
                  className="size-4 accent-accent"
                  onChange={(event) => {
                    setForm({ ...form, isActive: event.target.checked });
                    setActionError("");
                  }}
                  type="checkbox"
                />
              </label>

              {actionError && (
                <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger" role="alert">
                  {actionError}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-[var(--text)] transition hover:bg-surface-2"
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isMutating}
                  type="submit"
                >
                  {isMutating
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : "Add table"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {dialog === "delete" && pendingDelete && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-describedby="delete-table-description"
            aria-labelledby="delete-table-title"
            aria-modal="true"
            className="my-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-[var(--text)] shadow-2xl"
            role="dialog"
          >
            <span className="grid size-11 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
              <Icon name="trash" />
            </span>
            <h2 className="mt-4 text-lg font-bold text-[var(--text)]" id="delete-table-title">
              Delete table {pendingDelete.tableNumber}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted" id="delete-table-description">
              <span className="font-medium text-[var(--text)]">{pendingDelete.name}</span> will
              be permanently removed from your restaurant. Tables with existing orders cannot be deleted.
            </p>
            {actionError && (
              <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger" role="alert">
                {actionError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-[var(--text)] transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating}
                onClick={closeDialog}
                type="button"
              >
                Keep table
              </button>
              <button
                className="h-10 rounded-xl bg-[#a3423c] px-4 text-sm font-semibold text-white transition hover:bg-[#873731] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating}
                onClick={deleteTable}
                type="button"
              >
                {isMutating ? "Deleting…" : "Delete table"}
              </button>
            </div>
          </section>
        </div>
      )}

      {dialog === "qr" && qrTable && (
        <div
          className="vr-table-qr-overlay fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-describedby="table-qr-description"
            aria-labelledby="table-qr-title"
            aria-modal="true"
            className="vr-table-qr-dialog my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-[28rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-surface p-3 text-[var(--text)] shadow-2xl sm:p-5"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold tracking-[0.16em] text-accent">
                  TABLE QR CODE
                </p>
                <h2 className="mt-2 text-lg font-bold text-[var(--text)]" id="table-qr-title">
                  Table {qrTable.tableNumber} · {qrTable.name}
                </h2>
                <p className="mt-1 text-sm text-muted" id="table-qr-description">
                  Scan to open the menu for this table.
                </p>
              </div>
              <button
                aria-label="Close QR code preview"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-[var(--text)]"
                onClick={closeDialog}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="vr-table-qr-print">
              <div className="vr-table-qr-print-brand">
                <span className="vr-table-qr-print-mark">VR</span>
                <div className="vr-table-qr-print-brand-copy">
                  <strong>Virtual Rudra</strong>
                  <span>TABLE MENU</span>
                </div>
                <span className="vr-table-qr-print-number">
                  T-{String(qrTable.tableNumber).padStart(2, "0")}
                </span>
              </div>
              <div className="vr-table-qr-print-heading">
                <p className="vr-table-qr-print-label">SCAN TO VIEW OUR MENU</p>
                <h3>{qrTable.name}</h3>
                <p>Table {qrTable.tableNumber} · Scan to explore the menu</p>
              </div>
              <div className="vr-table-qr-code-frame">
                {qrImage ? (
                  <Image
                    alt={`QR code for table ${qrTable.tableNumber}`}
                    className="vr-table-qr-image"
                    height={1024}
                    src={qrImage}
                    unoptimized
                    width={1024}
                  />
                ) : qrError ? (
                  <p className="vr-table-qr-message" role="alert">
                    {qrError}
                  </p>
                ) : (
                  <p className="vr-table-qr-message" role="status">
                    Generating QR code…
                  </p>
                )}
              </div>
              <p className="vr-table-qr-print-hint">
                Point your phone camera at the code to open the menu.
              </p>
              <div className="vr-table-qr-print-footer">
                <span>VIRTUAL RUDRA</span>
                <span>TABLE {qrTable.tableNumber}</span>
              </div>
            </div>

            <div className="vr-table-qr-url mt-4 min-w-0">
              <p className="mb-1.5 text-[10px] font-bold tracking-[0.12em] text-accent">
                MENU LINK
              </p>
              <p className="break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] leading-4 text-muted">
                {qrUrl || "Unavailable: a valid QR link could not be generated."}
              </p>
            </div>

            {qrDownloadError && (
              <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {qrDownloadError}
              </p>
            )}
            {qrPrintError && (
              <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {qrPrintError}
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2 sm:flex sm:justify-end">
              <button
                aria-label="Download QR code as PNG"
                className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-2 text-[11px] font-medium text-[var(--text)] transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:gap-2 sm:px-3 sm:text-xs"
                disabled={!qrImage || downloadingQr}
                onClick={() => void downloadQr()}
                type="button"
              >
                <Icon name="download" />
                <span className="sm:hidden">{downloadingQr ? "Wait…" : "PNG"}</span>
                <span className="hidden sm:inline">
                  {downloadingQr ? "Preparing…" : "Download PNG"}
                </span>
              </button>
              <button
                aria-label="Print QR card"
                className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-2 text-[11px] font-medium text-[var(--text)] transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:gap-2 sm:px-3 sm:text-xs"
                disabled={!qrImage}
                onClick={printQrCard}
                type="button"
              >
                <Icon name="print" />
                <span className="sm:hidden">Print</span>
                <span className="hidden sm:inline">Print card</span>
              </button>
              <button
                className="h-10 min-w-0 rounded-xl bg-accent px-2 text-[11px] font-semibold text-white transition hover:bg-accent-hover sm:h-9 sm:px-4 sm:text-xs"
                onClick={closeDialog}
                type="button"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: "tables" | "check" | "pause" | "seats";
}) {
  return (
    <article className="!min-h-0 !gap-1.5 rounded-2xl border border-border bg-surface !p-3 shadow-[0_8px_24px_rgba(0,0,0,0.06)] md:!p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </p>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-accent">
          <Icon name={icon} />
        </span>
      </div>
      <div className="flex min-w-0 items-baseline gap-2">
        <p className="mt-0 text-2xl font-bold tracking-tight text-[var(--text)]">{value}</p>
        <p className="mt-0 truncate text-[10px] text-muted">{detail}</p>
      </div>
    </article>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
        isActive
          ? "border-sage/30 bg-sage-soft text-sage"
          : "border-border bg-surface-2 text-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${isActive ? "bg-sage" : "bg-muted"}`}
      />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function Icon({
  name,
}: {
  name:
    | "plus"
    | "tables"
    | "check"
    | "pause"
    | "search"
    | "seats"
    | "edit"
    | "trash"
    | "close"
    | "qr"
    | "download"
    | "print";
}) {
  const paths = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    tables: <><rect x="3" y="4" width="18" height="7" rx="2" /><path d="M7 11v9m10-9v9M3 16h18" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    pause: <><path d="M8 5v14m8-14v14" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" /></>,
    seats: <><path d="M6 11V5a2 2 0 0 1 4 0v6m4 0V5a2 2 0 0 1 4 0v6M4 11h16v3a3 3 0 0 1-3 3h-1v3h-2v-3h-4v3H8v-3H7a3 3 0 0 1-3-3v-3Z" /></>,
    edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></>,
    trash: <><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zm5 0h2m-7 5h3m2-2v4m2-2h1" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 17v4h14v-4" /></>,
    print: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}
