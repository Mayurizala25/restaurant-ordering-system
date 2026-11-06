"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const REFRESH_THRESHOLD = 72;
const MAX_PULL_DISTANCE = 88;
const REFRESH_INDICATOR_DURATION = 900;
const SOFT_REFRESH_EVENT = "virtual-rudra:refresh";

export default function PullToRefresh({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const pullDistanceRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (pathname === "/admin/login") return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    function resetPull() {
      tracking = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }

    function handleTouchStart(event: TouchEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (
        refreshing ||
        (!window.matchMedia("(pointer: coarse)").matches &&
          window.innerWidth > 900) ||
        window.scrollY > 1 ||
        event.touches.length !== 1 ||
        target?.closest(
          "input, textarea, select, button, a, [role='dialog'], [data-no-pull-to-refresh]",
        )
      ) {
        tracking = false;
        return;
      }

      let ancestor = target;
      while (ancestor && ancestor !== rootRef.current) {
        const style = window.getComputedStyle(ancestor);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          ancestor.scrollHeight > ancestor.clientHeight &&
          ancestor.scrollTop > 1
        ) {
          tracking = false;
          return;
        }
        ancestor = ancestor.parentElement;
      }

      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
    }

    function handleTouchMove(event: TouchEvent) {
      if (!tracking || event.touches.length !== 1) return;

      const deltaX = event.touches[0].clientX - startX;
      const deltaY = event.touches[0].clientY - startY;
      if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY < 0) {
        resetPull();
        return;
      }

      if (deltaY > 0) {
        if (event.cancelable) event.preventDefault();
        const distance = Math.min(deltaY * 0.72, MAX_PULL_DISTANCE);
        pullDistanceRef.current = distance;
        setPullDistance(distance);
      }
    }

    function handleTouchEnd() {
      if (tracking && pullDistanceRef.current >= REFRESH_THRESHOLD) {
        setRefreshing(true);
        window.dispatchEvent(new Event(SOFT_REFRESH_EVENT));
        refreshTimerRef.current = window.setTimeout(() => {
          setRefreshing(false);
          resetPull();
          refreshTimerRef.current = null;
        }, REFRESH_INDICATOR_DURATION);
        return;
      }
      resetPull();
    }

    function handleTouchCancel() {
      resetPull();
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchCancel);
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [pathname, refreshing]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  const isPulling = pullDistance > 0 && !refreshing;

  return (
    <div className="vr-refresh-root" ref={rootRef}>
      {(isPulling || refreshing) && (
        <div
          aria-live="polite"
          className="vr-pull-indicator"
          role="status"
          style={{
            transform: `translate(-50%, ${refreshing ? 70 : Math.min(pullDistance, 72)}px)`,
          }}
        >
          {refreshing
            ? "Refreshing…"
            : pullDistance >= REFRESH_THRESHOLD
              ? "Release to refresh"
              : "Pull to refresh"}
        </div>
      )}
      {children}
    </div>
  );
}
