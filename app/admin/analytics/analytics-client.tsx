"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminMetricCard, AdminPageHeading } from "../_components/admin-page";
import {
  fetchJsonWithTimeout,
  RequestCancelledError,
  RequestTimeoutError,
} from "../_lib/request-timeout";

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
const chartDay = new Intl.DateTimeFormat("en-IN", { weekday: "short" });

export default function AdminAnalyticsClient() {
  const [totalScans, setTotalScans] = useState<number | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadInFlight = useRef(false);
  const loadController = useRef<AbortController | null>(null);

  const loadAnalytics = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/qr-analytics",
        { cache: "no-store", signal: controller.signal },
        15_000,
      );
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
      if (!(cause instanceof RequestCancelledError)) {
        setError(
          cause instanceof RequestTimeoutError
            ? "Loading QR scan analytics timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load QR scan analytics.",
        );
      }
    } finally {
      loadInFlight.current = false;
      if (loadController.current === controller) loadController.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnalytics();
    }, 0);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadAnalytics();
    };
    window.addEventListener("focus", loadAnalytics);
    window.addEventListener("pageshow", loadAnalytics);
    window.addEventListener("virtual-rudra:refresh", loadAnalytics);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", loadAnalytics);
      window.removeEventListener("pageshow", loadAnalytics);
      window.removeEventListener("virtual-rudra:refresh", loadAnalytics);
      document.removeEventListener("visibilitychange", handleVisibility);
      loadController.current?.abort();
    };
  }, [loadAnalytics]);

  const distinctTables = new Set(scans.map((scan) => scan.tableId)).size;
  const scanDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const count = scans.filter(
      (scan) => new Date(scan.scannedAt).toDateString() === date.toDateString(),
    ).length;
    return { date, count };
  });
  const maxDailyScans = Math.max(...scanDays.map((day) => day.count), 1);

  return (
    <main className="vr-admin-route-page min-h-screen bg-[#111318] px-4 py-6 text-[#f3f4f6] sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1100px]">
        <AdminPageHeading
          description="See how guests discover your menu at the table."
          eyebrow="RESTAURANT ANALYTICS"
          title="QR scan activity"
        >
          <button
            className="vr-admin-page-secondary-action"
            disabled={loading}
            onClick={() => void loadAnalytics()}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" />
            </svg>
            {loading ? "Updating" : "Refresh"}
          </button>
        </AdminPageHeading>

        <section aria-label="QR scan summary" className="vr-admin-metric-grid">
          <AdminMetricCard
            detail="All-time restaurant scans"
            icon="activity"
            label="Total scans"
            value={totalScans === null ? "—" : totalScans.toLocaleString("en-IN")}
          />
          <AdminMetricCard
            detail="Distinct tables in latest activity"
            icon="table"
            label="Tables in recent scans"
            value={loading || error ? "—" : String(distinctTables)}
          />
          <AdminMetricCard
            detail="Most recent activity"
            icon="rating"
            label="Recent scans"
            value={loading || error ? "—" : String(scans.length)}
          />
        </section>

        <section
          aria-label="Recent scan distribution"
          className="vr-admin-scan-chart mb-5 rounded-[14px] border border-[#30343d] bg-[#191c22] p-5"
        >
          <div className="vr-admin-chart-heading">
            <div>
              <h2>Recent activity</h2>
              <p>Latest 25 table scans by day</p>
            </div>
            <span>Last 7 days</span>
          </div>
          {loading ? (
            <p className="vr-admin-chart-message" role="status">
              Loading recent scan activity…
            </p>
          ) : error ? (
            <p className="vr-admin-chart-message" role="alert">
              Activity chart is unavailable.
            </p>
          ) : scans.length === 0 ? (
            <p className="vr-admin-chart-message">
              No table QR scans have been recorded yet.
            </p>
          ) : (
            <div className="vr-admin-scan-chart-bars">
              {scanDays.map(({ date, count }) => (
                <div
                  aria-label={`${date.toLocaleDateString("en-IN", { dateStyle: "medium" })}: ${count} scans`}
                  className="vr-admin-scan-chart-day"
                  key={date.toISOString()}
                  role="img"
                >
                  <span className="vr-admin-scan-bar-track">
                    <span
                      className="vr-admin-scan-bar"
                      style={{
                        height: `${Math.max(4, (count / maxDailyScans) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="vr-admin-scan-chart-label">
                    {chartDay.format(date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          aria-labelledby="recent-scans-heading"
          className="vr-admin-activity-panel overflow-hidden rounded-[14px] border border-[#30343d] bg-[#191c22]"
        >
          <header className="vr-admin-panel-heading">
            <div>
              <h2 id="recent-scans-heading">Recent scan activity</h2>
              <p>Latest recorded table QR visits</p>
            </div>
            <span className="vr-admin-panel-count">
              {scans.length} {scans.length === 1 ? "scan" : "scans"}
            </span>
          </header>
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
