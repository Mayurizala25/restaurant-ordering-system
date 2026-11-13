"use client";

import { useEffect, useState } from "react";
import { AdminMetricCard, AdminPageHeading } from "../_components/admin-page";
import {
  fetchJsonWithTimeout,
  RequestTimeoutError,
} from "../_lib/request-timeout";

type Feedback = {
  id: string;
  orderId: string;
  rating: number;
  comment: string;
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeedback(value: unknown): value is Feedback {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.orderId === "string" &&
    typeof value.rating === "number" &&
    Number.isSafeInteger(value.rating) &&
    value.rating >= 1 &&
    value.rating <= 5 &&
    typeof value.comment === "string" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

const feedbackDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function AdminFeedbackClient() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let loadInFlight = false;
    let loadController: AbortController | null = null;
    async function loadFeedback() {
      if (loadInFlight) return;
      loadInFlight = true;
      setLoading(true);
      setError("");
      const controller = new AbortController();
      loadController = controller;
      try {
        const { response, payload } = await fetchJsonWithTimeout(
          "/api/admin/feedback",
          { cache: "no-store", signal: controller.signal },
          15_000,
        );
        if (!response.ok) {
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not load restaurant feedback.",
          );
        }
        if (
          !isRecord(payload) ||
          !Array.isArray(payload.feedback) ||
          !payload.feedback.every(isFeedback)
        ) {
          throw new Error("Feedback data could not be read.");
        }
        if (active) {
          setFeedback(payload.feedback);
          setError("");
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof RequestTimeoutError
              ? "Loading restaurant feedback timed out. Try again."
              : cause instanceof Error
              ? cause.message
              : "Could not load restaurant feedback.",
          );
        }
      } finally {
        loadInFlight = false;
        if (loadController === controller) loadController = null;
        if (active) setLoading(false);
      }
    }

    void loadFeedback();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadFeedback();
    };
    window.addEventListener("focus", loadFeedback);
    window.addEventListener("pageshow", loadFeedback);
    window.addEventListener("virtual-rudra:refresh", loadFeedback);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      loadController?.abort();
      window.removeEventListener("focus", loadFeedback);
      window.removeEventListener("pageshow", loadFeedback);
      window.removeEventListener("virtual-rudra:refresh", loadFeedback);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const averageRating =
    feedback.length > 0
      ? (
          feedback.reduce((total, entry) => total + entry.rating, 0) /
          feedback.length
        ).toFixed(1)
      : "—";
  const fiveStarCount = feedback.filter((entry) => entry.rating === 5).length;

  return (
    <main className="vr-admin-feedback-page vr-admin-route-page min-h-screen bg-[#111318] px-4 py-6 text-[#f3f4f6] sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1100px]">
        <AdminPageHeading
          description="Guest ratings and comments from recent orders."
          eyebrow="GUEST EXPERIENCE"
          title="Customer feedback"
        />

        <section aria-label="Feedback summary" className="vr-admin-metric-grid">
          <AdminMetricCard
            detail="All submitted guest reviews"
            icon="activity"
            label="Reviews received"
            value={loading ? "—" : String(feedback.length)}
          />
          <AdminMetricCard
            detail={feedback.length === 0 ? "Awaiting guest reviews" : "Out of 5 stars"}
            icon="rating"
            label="Average rating"
            value={loading ? "—" : averageRating}
          />
          <AdminMetricCard
            detail="Five-star guest reviews"
            icon="table"
            label="5-star reviews"
            value={loading ? "—" : String(fiveStarCount)}
          />
        </section>

        <section
          aria-label="Customer feedback"
          className="vr-admin-feedback-panel overflow-hidden rounded-[14px] border border-[#30343d] bg-[#191c22]"
        >
          <header className="vr-admin-panel-heading">
            <div>
              <h2>Guest reviews</h2>
              <p>Feedback is linked to its original order.</p>
            </div>
            <span className="vr-admin-panel-count">
              {loading
                ? "Loading"
                : `${feedback.length} ${feedback.length === 1 ? "review" : "reviews"}`}
            </span>
          </header>
          {loading ? (
            <p className="px-5 py-8 text-sm text-[#9299a6]" role="status">
              Loading feedback…
            </p>
          ) : error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6">
              <p className="text-sm text-[#ff958a]" role="alert">{error}</p>
              <button
                className="text-xs font-semibold text-[#ffad70] hover:underline"
                onClick={() =>
                  window.dispatchEvent(new Event("virtual-rudra:refresh"))
                }
                type="button"
              >
                Try again
              </button>
            </div>
          ) : feedback.length === 0 ? (
            <p className="px-5 py-8 text-sm text-[#9299a6]">
              No feedback has been submitted yet.
            </p>
          ) : (
            <ul className="divide-y divide-[#30343d]">
              {feedback.map((entry) => (
                <li className="vr-admin-feedback-card grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" key={entry.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        aria-label={`${entry.rating} out of 5 stars`}
                        className="text-sm tracking-wide text-[#ffad70]"
                      >
                        {"★".repeat(entry.rating)}
                        <span className="text-[#555b66]">
                          {"★".repeat(5 - entry.rating)}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-[#9299a6]">
                        Order {entry.orderId.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                    {entry.comment ? (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#d3d5da]">
                        {entry.comment}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs italic text-[#777e89]">
                        No written comment.
                      </p>
                    )}
                  </div>
                  <time
                    className="text-xs text-[#9299a6]"
                    dateTime={entry.createdAt}
                  >
                    {feedbackDate.format(new Date(entry.createdAt))}
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
