"use client";

import { useEffect, useState } from "react";

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
    async function loadFeedback() {
      try {
        const response = await fetch("/api/admin/feedback", {
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
            cause instanceof Error
              ? cause.message
              : "Could not load restaurant feedback.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFeedback();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#111318] px-4 py-6 text-[#f3f4f6] sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.16em] text-[#ff9a4d]">
            RESTAURANT ADMIN
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Customer feedback</h1>
          <p className="mt-1 text-sm text-[#9299a6]">
            Ratings and comments submitted for this restaurant.
          </p>
        </div>

        <section
          aria-label="Customer feedback"
          className="overflow-hidden rounded-[14px] border border-[#30343d] bg-[#191c22]"
        >
          {loading ? (
            <p className="px-5 py-8 text-sm text-[#9299a6]" role="status">
              Loading feedback…
            </p>
          ) : error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6">
              <p className="text-sm text-[#ff958a]" role="alert">{error}</p>
              <button
                className="text-xs font-semibold text-[#ffad70] hover:underline"
                onClick={() => window.location.reload()}
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
                <li className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" key={entry.id}>
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
