"use client";

import { useCallback, useEffect, useState } from "react";

type Scan = {
  id: string;
  tableId: string;
  tableNumber: number;
  qrType: "table_menu";
  scannedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScan(value: unknown): value is Scan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.tableId === "string" &&
    typeof value.tableNumber === "number" &&
    Number.isSafeInteger(value.tableNumber) &&
    value.qrType === "table_menu" &&
    typeof value.scannedAt === "string" &&
    Number.isFinite(Date.parse(value.scannedAt))
  );
}

const scanDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function AdminAnalyticsClient() {
  const [totalScans, setTotalScans] = useState<number | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/qr-analytics", {
        cache: "no-store",
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
            : "Could not load QR scan analytics.",
        );
      }
      if (
        !isRecord(payload) ||
        typeof payload.totalScans !== "number" ||
        !Number.isSafeInteger(payload.totalScans) ||
        payload.totalScans < 0 ||
        !Array.isArray(payload.scans) ||
        !payload.scans.every(isScan)
      ) {
        throw new Error("QR scan analytics could not be read.");
      }
      setTotalScans(payload.totalScans);
      setScans(payload.scans);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load QR scan analytics.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnalytics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAnalytics]);

  return (
    <main className="min-h-screen bg-[#111318] px-4 py-6 text-[#f3f4f6] sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.16em] text-[#ff9a4d]">
            RESTAURANT ADMIN
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            QR scan analytics
          </h1>
          <p className="mt-1 text-sm text-[#9299a6]">
            Table menu QR scans for this restaurant.
          </p>
        </div>

        <section
          aria-label="Total QR scans"
          className="mb-5 rounded-[14px] border border-[#30343d] bg-[#191c22] p-5"
        >
          <p className="text-xs font-medium text-[#9299a6]">Total scans</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-[#ffad70]" aria-live="polite">
            {loading && totalScans === null ? "—" : totalScans ?? "—"}
          </p>
        </section>

        <section
          aria-labelledby="recent-scans-heading"
          className="overflow-hidden rounded-[14px] border border-[#30343d] bg-[#191c22]"
        >
          <div className="border-b border-[#30343d] px-5 py-4">
            <h2 className="text-sm font-bold" id="recent-scans-heading">
              Recent scan activity
            </h2>
            <p className="mt-1 text-xs text-[#9299a6]">Latest 25 table QR scans</p>
          </div>
          {loading ? (
            <p className="px-5 py-7 text-sm text-[#9299a6]" role="status">
              Loading scan activity…
            </p>
          ) : error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6">
              <p className="text-sm text-[#ff958a]" role="alert">{error}</p>
              <button
                className="text-xs font-semibold text-[#ffad70] hover:underline"
                onClick={() => void loadAnalytics()}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : scans.length === 0 ? (
            <p className="px-5 py-7 text-sm text-[#9299a6]">
              No table QR scans have been recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-[#30343d]">
              {scans.map((scan) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5"
                  key={scan.id}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-[#202821] text-[#82c795]" aria-hidden="true">
                      <svg
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                        className="size-[18px]"
                      >
                        <rect x="3" y="4" width="18" height="7" rx="2" />
                        <path d="M7 11v9m10-9v9M3 16h18" />
                      </svg>
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">
                        Table {scan.tableNumber}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[#9299a6]">
                        Table menu QR
                      </span>
                    </span>
                  </div>
                  <time
                    className="text-xs text-[#9299a6]"
                    dateTime={scan.scannedAt}
                  >
                    {scanDate.format(new Date(scan.scannedAt))}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
