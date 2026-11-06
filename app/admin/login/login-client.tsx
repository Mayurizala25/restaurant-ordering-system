"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchJsonWithTimeout,
  RequestTimeoutError,
} from "../_lib/request-timeout";

export default function AdminLoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("light");
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
    event.preventDefault();
    setNotice("");
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setNotice("Enter both your email address and password.");
      event.currentTarget.querySelector<HTMLInputElement>(
        !email ? "#email" : "#password",
      )?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice("Enter a valid email address.");
      event.currentTarget.querySelector<HTMLInputElement>("#email")?.focus();
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
      router.replace("/admin/dashboard");
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
    <main
      className="vr-admin-login grid min-h-[100svh] bg-[#f5f6f2] text-[#202521] md:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]"
      data-admin-theme={theme}
    >
      <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-[#174b39] px-12 py-10 text-white md:flex lg:px-16 xl:px-20">
        <div className="relative z-10 flex items-center gap-3 font-semibold">
          <Image
            alt=""
            className="size-10 rounded-xl"
            height={40}
            loading="eager"
            src="/brand/virtual-rudra-logo.png?v=2"
            unoptimized
            width={40}
          />
          <span>Virtual Rudra</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <div className="mb-8 grid size-20 place-items-center rounded-3xl border border-white/15 bg-white/10">
            <Image
              alt=""
              className="size-11 rounded-xl"
              height={44}
              loading="eager"
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={44}
            />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">
            Made for memorable meals.
          </h1>
          <p className="mt-4 max-w-md text-base leading-7 text-white/75">
            A considered workspace for running your restaurant.
          </p>
        </div>

        <p className="relative z-10 text-xs tracking-[0.16em] text-white/65">
          RESTAURANT MANAGEMENT · REIMAGINED
        </p>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-64 -right-52 size-[34rem] rounded-full border border-white/10 shadow-[0_0_0_5rem_rgba(255,255,255,0.025),0_0_0_10rem_rgba(255,255,255,0.02)]"
        />
      </section>

      <section className="relative flex min-h-[100svh] items-center justify-center px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
        <button
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="vr-admin-login-theme-toggle absolute right-5 top-5 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition"
          onClick={toggleTheme}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="size-4"
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
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-3 font-semibold md:hidden">
            <Image
              alt=""
              className="size-10 rounded-xl object-contain"
              height={40}
              loading="eager"
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={40}
            />
            <span>Virtual Rudra</span>
          </div>

          <div className="vr-admin-login-card rounded-2xl border border-[#2a2e38] bg-[#15181e] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-8">
            <div className="mb-8">
              <p className="mb-2 text-xs font-bold tracking-[0.16em] text-[#185c43]">
                ADMIN PORTAL
              </p>
              <h2 className="text-3xl font-semibold tracking-tight">
                Welcome back
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#747b75]">
                Sign in to your restaurant workspace.
              </p>
            </div>

            <form className="space-y-5" noValidate onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="block text-sm font-medium" htmlFor="email">
                  Email address
                </label>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  className="h-12 w-full rounded-xl border border-[#e5e8e2] bg-white px-4 text-base text-left leading-normal outline-none transition placeholder:text-[#9aa19b] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15 disabled:cursor-not-allowed disabled:opacity-60"
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

              <div className="space-y-2">
                <label className="block text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    autoCapitalize="none"
                    autoComplete="current-password"
                    className="h-12 w-full rounded-xl border border-[#e5e8e2] bg-white px-4 pr-12 text-base text-left leading-normal outline-none transition placeholder:text-[#9aa19b] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15 disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-[#747b75] transition hover:text-[#185c43] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#185c43]"
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
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#185c43] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#124b36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#185c43] disabled:cursor-wait disabled:opacity-75"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
              {notice && (
                <p
                  aria-live="polite"
                  className="text-sm leading-5 text-[#a3423c]"
                  id="login-notice"
                  role="alert"
                >
                  {notice}
                </p>
              )}
            </form>

            <p className="mt-7 text-center text-xs text-[#747b75]">
              Protected admin access
            </p>
            {themeError && (
              <p className="mt-3 text-center text-xs text-[#a3423c]" role="alert">
                {themeError}
              </p>
            )}
          </div>
        </div>
      </section>
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
