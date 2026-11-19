"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchJsonWithTimeout,
  RequestTimeoutError,
} from "../_lib/request-timeout";
import { getAdminPostLoginPath } from "../_lib/post-login-path";

export default function AdminLoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [themeError, setThemeError] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const savedTheme = window.localStorage.getItem("vr-admin-theme");
        if (savedTheme === "light" || savedTheme === "dark") {
          setTheme(savedTheme);
        }
      } catch {
        setThemeError("Theme preference could not be loaded from this browser.");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    setThemeError("");
    try {
      window.localStorage.setItem("vr-admin-theme", nextTheme);
    } catch {
      setThemeError("Theme changed, but could not be saved for your next visit.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    event.preventDefault();
    setNotice("");
    const emailField = form.elements.namedItem("email");
    const passwordField = form.elements.namedItem("password");
    const email =
      emailField instanceof HTMLInputElement
        ? emailField.value.trim().toLowerCase()
        : "";
    const password =
      passwordField instanceof HTMLInputElement ? passwordField.value : "";

    if (!email) {
      setNotice("Enter your email address.");
      form.querySelector<HTMLInputElement>("#email")?.focus();
      return;
    }
    if (!password) {
      setNotice("Enter your password.");
      form.querySelector<HTMLInputElement>("#password")?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice("Enter a valid email address.");
      form.querySelector<HTMLInputElement>("#email")?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      const { response, payload: result } = await fetchJsonWithTimeout(
        "/api/admin/session",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
        },
        15_000,
      );
      if (!response.ok) {
        let errorMessage = "Could not sign in. Check your credentials and try again.";
        if (
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
        ) {
          errorMessage = result.error;
        }
        setNotice(errorMessage);
        return;
      }
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      router.replace(getAdminPostLoginPath(returnTo));
    } catch (cause) {
      setNotice(
        cause instanceof RequestTimeoutError
          ? "Admin sign-in timed out. Try again."
          : cause instanceof Error
            ? cause.message
            : "Could not reach admin sign-in. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="vr-admin-login" data-admin-theme={theme}>
      <header className="vr-admin-login-header">
        <div className="vr-admin-login-brand">
          <span className="vr-admin-login-brand-mark">
            <Image
              alt=""
              className="vr-admin-login-logo"
              height={48}
              loading="eager"
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={48}
            />
          </span>
          <span className="vr-admin-login-brand-copy">
            <strong>Virtual Rudra</strong>
            <small>CULINARY OPS</small>
          </span>
        </div>
        <div className="vr-admin-login-header-actions">
          <span className="vr-admin-login-security">
            <span aria-hidden="true" />
            Admin Secure
          </span>
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="vr-admin-login-theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
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
              {theme === "dark" ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </>
              ) : (
                <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
              )}
            </svg>
          </button>
        </div>
      </header>

      <div className="vr-admin-login-main">
        <section
          aria-labelledby="admin-login-title"
          className="vr-admin-login-card"
        >
          <div className="vr-admin-login-intro">
            <p className="vr-admin-login-eyebrow">
              ADMIN PORTAL <span aria-hidden="true">•</span> RESTRICTED
            </p>
            <h1 id="admin-login-title">Welcome back</h1>
            <p>Sign in to manage kitchen operations, menu items, and dining orders.</p>
          </div>

          <form
            className="vr-admin-login-form"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="vr-admin-login-field">
              <label htmlFor="email">Email / Admin ID</label>
              <div className="vr-admin-login-input-wrap">
                <svg
                  aria-hidden="true"
                  className="vr-admin-login-input-icon"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  disabled={isSubmitting}
                  id="email"
                  inputMode="email"
                  maxLength={254}
                  name="email"
                  onChange={() => setNotice("")}
                  placeholder="admin@virtualrudra.com"
                  required
                  spellCheck={false}
                  type="email"
                />
              </div>
            </div>

            <div className="vr-admin-login-field">
              <label htmlFor="password">Password</label>
              <div className="vr-admin-login-input-wrap">
                <svg
                  aria-hidden="true"
                  className="vr-admin-login-input-icon"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                >
                  <rect x="4" y="10" width="16" height="11" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
                </svg>
                <input
                  autoCapitalize="none"
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  id="password"
                  name="password"
                  onChange={() => setNotice("")}
                  placeholder="Enter your password"
                  required
                  spellCheck={false}
                  type={showPassword ? "text" : "password"}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="vr-admin-login-password-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  title={showPassword ? "Hide password" : "Show password"}
                  type="button"
                >
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
            </div>

            <button
              aria-busy={isSubmitting}
              className="vr-admin-login-submit"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Signing in…" : "Sign in to Dashboard"}
              {!isSubmitting && (
                <svg
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                >
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              )}
            </button>
            {notice && (
              <p
                aria-live="polite"
                className="vr-admin-login-notice"
                id="login-notice"
                role="alert"
              >
                {notice}
              </p>
            )}
          </form>

          <div className="vr-admin-login-protected">
            <svg
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            >
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <span>Protected admin access</span>
          </div>
          {themeError && (
            <p className="vr-admin-login-notice" role="alert">
              {themeError}
            </p>
          )}
        </section>

        <section
          aria-labelledby="admin-login-workspace-title"
          className="vr-admin-login-workspace"
        >
          <h2 id="admin-login-workspace-title">WORKSPACE ACCESS</h2>
          <div>
            <span>Menu &amp; Items</span>
            <span>Dining Orders</span>
            <span>Kitchen Operations</span>
          </div>
        </section>
      </div>

      <footer className="vr-admin-login-footer">
        <span>Virtual Rudra</span>
        <span aria-hidden="true">•</span>
        <span>Kitchen Management Portal</span>
      </footer>
    </main>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {visible ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5 0 8.3 4.2 9 7-.2.9-.9 2-1.9 3" />
          <path d="M6.2 6.2C4 7.7 2.9 10 3 12c.5 2.2 2.3 4.4 4.8 5.7A10 10 0 0 0 12 19c.9 0 1.8-.1 2.6-.4" />
        </>
      ) : (
        <>
          <path d="M2.8 12s3.2-7 9.2-7 9.2 7 9.2 7-3.2 7-9.2 7-9.2-7-9.2-7Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
    </svg>
  );
}
