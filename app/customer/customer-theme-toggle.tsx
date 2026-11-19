"use client";

import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "virtual-rudra.customer-theme";
type CustomerTheme = "light" | "dark";

function getCustomerRoot() {
  return document.querySelector<HTMLElement>(".vr-home-page, .vr-menu-page");
}

function applyTheme(theme: CustomerTheme) {
  getCustomerRoot()?.setAttribute("data-customer-theme", theme);
}

export default function CustomerThemeToggle() {
  const [theme, setTheme] = useState<CustomerTheme>("dark");
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    function syncTheme(theme: CustomerTheme) {
      setTheme(theme);
      applyTheme(theme);
    }

    function handleThemeChange(event: Event) {
      const theme = (event as CustomEvent<CustomerTheme>).detail;
      if (theme === "light" || theme === "dark") syncTheme(theme);
    }

    function handleThemeError(event: Event) {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === "string") setStorageError(message);
    }

    function handleStorageChange(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      const storedTheme = event.newValue;
      if (storedTheme === "light" || storedTheme === "dark") {
        syncTheme(storedTheme);
      }
    }

    window.addEventListener("customer-theme-change", handleThemeChange);
    window.addEventListener("customer-theme-error", handleThemeError);
    window.addEventListener("storage", handleStorageChange);

    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") {
        window.dispatchEvent(
          new CustomEvent("customer-theme-change", { detail: storedTheme }),
        );
      }
    } catch (cause) {
      window.dispatchEvent(
        new CustomEvent("customer-theme-error", {
          detail:
            cause instanceof Error
              ? `Theme preference could not be loaded: ${cause.message}`
              : "Theme preference could not be loaded from this browser.",
        }),
      );
    }

    return () => {
      window.removeEventListener("customer-theme-change", handleThemeChange);
      window.removeEventListener("customer-theme-error", handleThemeError);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setStorageError("");
    window.dispatchEvent(
      new CustomEvent("customer-theme-change", { detail: nextTheme }),
    );
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (cause) {
      setStorageError(
        cause instanceof Error
          ? `Theme changed, but could not be saved: ${cause.message}`
          : "Theme changed, but could not be saved for your next visit.",
      );
    }
  }

  return (
    <>
      <button
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        aria-pressed={theme === "dark"}
        className="vr-customer-theme-toggle"
        onClick={toggleTheme}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        >
          {theme === "dark" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
            </>
          ) : (
            <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
          )}
        </svg>
        <span>{theme === "dark" ? "Light" : "Dark"}</span>
      </button>
      {storageError && (
        <span aria-live="polite" className="sr-only" role="status">
          {storageError}
        </span>
      )}
    </>
  );
}
