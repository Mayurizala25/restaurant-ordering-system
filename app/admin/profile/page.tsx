"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { SignOutButton } from "../_lib/admin-provider";

type RestaurantProfile = {
  name: string;
  logoUrl: string;
  coverImageUrl: string;
  address: string;
  phone: string;
  openingHours: string;
  currency: string;
  googleReviewUrl: string;
};

const DEFAULT_PROFILE: RestaurantProfile = {
  name: "",
  logoUrl: "",
  coverImageUrl: "",
  address: "",
  phone: "",
  openingHours: "",
  currency: "INR",
  googleReviewUrl: "",
};

const navigation = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "dashboard" },
  { label: "Menu Categories", href: "/admin/categories", icon: "category" },
  { label: "Menu Items", href: "/admin/menu-items", icon: "menu" },
  { label: "Profile", href: "/admin/profile", icon: "profile" },
] as const;

const inputClass =
  "h-11 w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 text-sm text-[#202521] outline-none transition placeholder:text-[#929a93] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15 disabled:bg-[#f8f9f6]";

function isProfile(value: unknown): value is RestaurantProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.name === "string" &&
    typeof profile.logoUrl === "string" &&
    typeof profile.coverImageUrl === "string" &&
    typeof profile.address === "string" &&
    typeof profile.phone === "string" &&
    typeof profile.openingHours === "string" &&
    typeof profile.currency === "string" &&
    typeof profile.googleReviewUrl === "string"
  );
}

export default function AdminProfilePage() {
  const [profile, setProfile] = useState<RestaurantProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reviewQrImage, setReviewQrImage] = useState("");
  const [reviewQrError, setReviewQrError] = useState("");
  const [generatingReviewQr, setGeneratingReviewQr] = useState(false);
  const [downloadingReviewQr, setDownloadingReviewQr] = useState(false);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      try {
        const response = await fetch("/api/admin/profile", {
          cache: "no-store",
        });
        const result: unknown = await response.json().catch(() => null);
        if (
          !response.ok ||
          typeof result !== "object" ||
          result === null ||
          !("profile" in result) ||
          !isProfile(result.profile)
        ) {
          const message =
            typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
              ? result.error
              : "Could not load restaurant profile.";
          throw new Error(message);
        }
        if (active) setProfile(result.profile);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load restaurant profile.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadProfile();

    return () => {
      active = false;
    };
  }, []);

  function updateProfile<K extends keyof RestaurantProfile>(
    key: K,
    value: RestaurantProfile[K],
  ) {
    setProfile((current) => ({ ...current, [key]: value }));
    if (key === "googleReviewUrl") {
      setReviewQrImage("");
      setReviewQrError("");
    }
    setNotice("");
    setError("");
  }

  function getValidReviewUrl(): string | null {
    const url = profile.googleReviewUrl.trim();
    if (!url || url.length > 2048) return null;
    try {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      ) {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  }

  async function generateReviewQr() {
    const reviewUrl = getValidReviewUrl();
    setReviewQrError("");
    setReviewQrImage("");
    if (!reviewUrl) {
      setReviewQrError("Enter a valid Google Review URL before generating its QR code.");
      return;
    }

    setGeneratingReviewQr(true);
    try {
      const image = await QRCode.toDataURL(reviewUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
        color: { dark: "#111318", light: "#ffffff" },
      });
      setReviewQrImage(image);
    } catch (cause) {
      setReviewQrError(
        cause instanceof Error
          ? `Could not generate the review QR code: ${cause.message}`
          : "Could not generate the review QR code.",
      );
    } finally {
      setGeneratingReviewQr(false);
    }
  }

  async function downloadReviewQr() {
    setReviewQrError("");
    if (!reviewQrImage) {
      setReviewQrError("Generate the review QR code before downloading it.");
      return;
    }

    setDownloadingReviewQr(true);
    try {
      const link = document.createElement("a");
      link.href = reviewQrImage;
      link.download = "virtual-rudra-google-review-qr.png";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (cause) {
      setReviewQrError(
        cause instanceof Error
          ? `Could not download the review QR code: ${cause.message}`
          : "Could not download the review QR code.",
      );
    } finally {
      setDownloadingReviewQr(false);
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");

    const normalized: RestaurantProfile = {
      name: profile.name.trim(),
      logoUrl: profile.logoUrl.trim(),
      coverImageUrl: profile.coverImageUrl.trim(),
      address: profile.address.trim(),
      phone: profile.phone.trim(),
      openingHours: profile.openingHours.trim(),
      currency: profile.currency.trim().toUpperCase(),
      googleReviewUrl: profile.googleReviewUrl.trim(),
    };
    if (!normalized.name || normalized.name.length > 120) {
      setError("Enter a restaurant name of 1–120 characters.");
      return;
    }
    if (
      !/^\+?[0-9][0-9 ()-]{5,28}[0-9]$/.test(normalized.phone) ||
      normalized.phone.replace(/\D/g, "").length < 7 ||
      normalized.phone.replace(/\D/g, "").length > 15
    ) {
      setError("Enter a valid phone number.");
      return;
    }
    if (!normalized.address || normalized.address.length > 250) {
      setError("Enter an address of 1–250 characters.");
      return;
    }
    if (normalized.openingHours.length > 500) {
      setError("Opening hours must be 500 characters or fewer.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(normalized.currency)) {
      setError("Enter a three-letter currency code, such as INR.");
      return;
    }
    for (const url of [
      normalized.logoUrl,
      normalized.coverImageUrl,
      normalized.googleReviewUrl,
    ]) {
      if (!url) continue;
      try {
        const parsed = new URL(url);
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          url.length > 2048
        ) {
          throw new Error("Invalid URL.");
        }
      } catch {
        setError("Enter valid http or https URLs, or leave them blank.");
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("profile" in result) ||
        !isProfile(result.profile)
      ) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Could not save restaurant profile.";
        throw new Error(message);
      }
      setProfile(result.profile);
      setNotice("Restaurant profile saved to Supabase.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save your profile. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6f2] text-[#202521] md:flex">
      <aside className="hidden w-[248px] shrink-0 border-r border-[#e5e8e2] bg-white px-4 py-6 md:flex md:flex-col">
        <Brand />
        <p className="mb-3 mt-10 px-3 text-[10px] font-bold tracking-[0.16em] text-[#929a93]">
          WORKSPACE
        </p>
        <nav aria-label="Admin navigation" className="space-y-1">
          {navigation.map((item) => <NavigationLink key={item.label} {...item} />)}
        </nav>
        <AdminIdentity />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-[#e5e8e2] bg-white px-5 py-4 sm:px-8 md:px-10">
          <div className="flex items-center justify-between gap-3">
            <div className="md:hidden"><Brand /></div>
            <p className="hidden text-sm font-medium text-[#535b55] md:block">Restaurant settings</p>
            <SignOutButton />
          </div>
          <nav aria-label="Admin navigation" className="mt-4 flex gap-2 overflow-x-auto md:hidden">
            {navigation.map((item) => <NavigationLink key={item.label} {...item} mobile />)}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1050px] px-5 py-7 sm:px-8 sm:py-9 md:px-10">
          <div className="mb-7">
            <p className="mb-1 text-[10px] font-bold tracking-[0.16em] text-[#185c43]">
              RESTAURANT SETTINGS
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-[27px]">Restaurant profile</h1>
            <p className="mt-1 text-sm text-[#747b75]">
              Manage the information shown to your guests.
            </p>
          </div>

          <form
            className="overflow-hidden rounded-[14px] border border-[#e5e8e2] bg-white shadow-[0_8px_24px_rgba(26,45,35,0.04)]"
            onSubmit={handleSave}
          >
            <div className="border-b border-[#e5e8e2] px-5 py-4 sm:px-7">
              <h2 className="font-bold">Restaurant details</h2>
              <p className="mt-1 text-xs text-[#747b75]">
                Your profile is saved to your restaurant account.
              </p>
            </div>

            <div className="space-y-7 px-5 py-6 sm:px-7 sm:py-7">
              <section>
                <h3 className="mb-3 text-sm font-medium">Restaurant images</h3>
                <div className="flex flex-wrap items-start gap-4">
                  <div
                    aria-label="Restaurant logo preview"
                    className="grid size-20 place-items-center overflow-hidden rounded-2xl border border-[#e5e8e2] bg-[#e5f1eb] text-[#185c43]"
                    role="img"
                    style={
                      profile.logoUrl
                        ? {
                            backgroundImage: `url("${profile.logoUrl}")`,
                            backgroundPosition: "center",
                            backgroundSize: "cover",
                          }
                        : undefined
                    }
                  >
                    {!profile.logoUrl && <Icon name="restaurant" className="size-9" />}
                  </div>
                  <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-logo">
                        Logo URL
                      </label>
                      <input
                        className={inputClass}
                        disabled={loading || saving}
                        id="restaurant-logo"
                        maxLength={2048}
                        onChange={(event) => updateProfile("logoUrl", event.target.value)}
                        placeholder="https://example.com/logo.jpg"
                        type="url"
                        value={profile.logoUrl}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-cover">
                        Cover image URL
                      </label>
                      <input
                        className={inputClass}
                        disabled={loading || saving}
                        id="restaurant-cover"
                        maxLength={2048}
                        onChange={(event) => updateProfile("coverImageUrl", event.target.value)}
                        placeholder="https://example.com/cover.jpg"
                        type="url"
                        value={profile.coverImageUrl}
                      />
                    </div>
                  </div>
                  {profile.logoUrl && (
                    <button
                      className="text-sm font-medium text-[#a3423c] hover:underline disabled:opacity-50"
                      disabled={loading || saving}
                      onClick={() => updateProfile("logoUrl", "")}
                      type="button"
                    >
                      Remove logo
                    </button>
                  )}
                </div>
              </section>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-name">
                    Restaurant name
                  </label>
                  <input
                    className={inputClass}
                    disabled={loading || saving}
                    id="restaurant-name"
                    maxLength={120}
                    onChange={(event) => updateProfile("name", event.target.value)}
                    required
                    value={profile.name}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-phone">
                    Phone number
                  </label>
                  <input
                    autoComplete="tel"
                    className={inputClass}
                    disabled={loading || saving}
                    id="restaurant-phone"
                    maxLength={30}
                    onChange={(event) => updateProfile("phone", event.target.value)}
                    required
                    type="tel"
                    value={profile.phone}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-currency">
                    Currency
                  </label>
                  <input
                    className={inputClass}
                    disabled={loading || saving}
                    id="restaurant-currency"
                    maxLength={3}
                    onChange={(event) => updateProfile("currency", event.target.value.toUpperCase())}
                    placeholder="INR"
                    required
                    value={profile.currency}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-address">
                    Address
                  </label>
                  <textarea
                    className="w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 py-2.5 text-sm text-[#202521] outline-none transition placeholder:text-[#929a93] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15 disabled:bg-[#f8f9f6]"
                    disabled={loading || saving}
                    id="restaurant-address"
                    maxLength={250}
                    onChange={(event) => updateProfile("address", event.target.value)}
                    required
                    rows={3}
                    value={profile.address}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="restaurant-hours">
                    Opening hours
                  </label>
                  <textarea
                    className="w-full rounded-[10px] border border-[#e5e8e2] bg-white px-3 py-2.5 text-sm text-[#202521] outline-none transition placeholder:text-[#929a93] focus:border-[#185c43] focus:ring-2 focus:ring-[#185c43]/15 disabled:bg-[#f8f9f6]"
                    disabled={loading || saving}
                    id="restaurant-hours"
                    maxLength={500}
                    onChange={(event) => updateProfile("openingHours", event.target.value)}
                    placeholder="e.g. Mon–Sun, 9:00 AM–10:00 PM"
                    rows={3}
                    value={profile.openingHours}
                  />
                </div>
              </div>

              <section
                aria-labelledby="google-review-heading"
                className="rounded-xl border border-[#e5e8e2] bg-[#fbfcfa] p-4 sm:p-5"
              >
                <div className="mb-4">
                  <h3 className="text-sm font-semibold" id="google-review-heading">
                    Google Reviews
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[#747b75]">
                    Save your review link, test it, or create a QR code customers can scan.
                  </p>
                </div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="google-review-url">
                  Google Review URL
                </label>
                <input
                  className={inputClass}
                  disabled={loading || saving}
                  id="google-review-url"
                  maxLength={2048}
                  onChange={(event) => updateProfile("googleReviewUrl", event.target.value)}
                  placeholder="https://g.page/r/..."
                  type="url"
                  value={profile.googleReviewUrl}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {getValidReviewUrl() ? (
                    <a
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-[#e5e8e2] px-3 text-xs font-semibold text-[#535b55] transition hover:border-[#185c43] hover:text-[#185c43]"
                      href={getValidReviewUrl() ?? undefined}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Test review URL
                    </a>
                  ) : (
                    <button
                      className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-lg border border-[#e5e8e2] px-3 text-xs font-semibold text-[#929a93] opacity-60"
                      disabled
                      type="button"
                    >
                      Test review URL
                    </button>
                  )}
                  <button
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-[#185c43] px-3 text-xs font-semibold text-white transition hover:bg-[#124b36] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading || saving || generatingReviewQr || !getValidReviewUrl()}
                    onClick={() => void generateReviewQr()}
                    type="button"
                  >
                    {generatingReviewQr ? "Generating…" : "Generate review QR"}
                  </button>
                  <button
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[#e5e8e2] px-3 text-xs font-semibold text-[#535b55] transition hover:border-[#185c43] hover:text-[#185c43] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!reviewQrImage || downloadingReviewQr}
                    onClick={() => void downloadReviewQr()}
                    type="button"
                  >
                    {downloadingReviewQr ? "Preparing…" : "Download QR"}
                  </button>
                </div>
                {reviewQrError && (
                  <p className="mt-3 text-xs text-[#a3423c]" role="alert">
                    {reviewQrError}
                  </p>
                )}
                {reviewQrImage && (
                  <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-[#e5e8e2] bg-white p-3">
                    <Image
                      alt="QR code linking to the restaurant's Google Review page"
                      className="size-36 rounded-md"
                      height={280}
                      src={reviewQrImage}
                      unoptimized
                      width={280}
                    />
                    <p className="max-w-sm text-xs leading-5 text-[#747b75]">
                      Scan to open the Google Review page. Save your profile changes to keep this URL for future visits.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-[#e5e8e2] bg-[#fbfcfa] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p
                aria-live="polite"
                className={`text-xs ${error ? "text-[#a3423c]" : "text-[#747b75]"}`}
                role={error ? "alert" : "status"}
              >
                {error || notice || (loading ? "Loading saved profile…" : "Changes are not saved yet.")}
              </p>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#185c43] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#124b36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#185c43] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || saving}
                type="submit"
              >
                <Icon name="check" />
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

function AdminIdentity() {
  return (
    <div className="mt-auto border-t border-[#e5e8e2] pt-5">
      <div className="flex items-center gap-3 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-[#e5f1eb] text-xs font-bold text-[#185c43]">VR</span>
        <span>
          <span className="block text-sm font-semibold">Virtual Rudra</span>
          <span className="block text-xs text-[#747b75]">Restaurant admin · demo</span>
        </span>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link className="flex items-center gap-3 font-bold text-[#202521]" href="/admin/dashboard">
      <span className="grid size-9 place-items-center rounded-xl bg-[#185c43] text-white">
        <Icon name="restaurant" />
      </span>
      <span className="whitespace-nowrap">Virtual Rudra</span>
    </Link>
  );
}

function NavigationLink({
  label,
  href,
  icon,
  mobile = false,
}: (typeof navigation)[number] & { mobile?: boolean }) {
  const active = href === "/admin/profile";
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-3 rounded-[10px] px-3 font-medium transition ${
        mobile ? "py-2 text-xs" : "py-3 text-sm"
      } ${
        active
          ? "bg-[#e5f1eb] text-[#185c43]"
          : "text-[#747b75] hover:bg-[#f8f9f6] hover:text-[#202521]"
      }`}
      href={href}
    >
      <Icon name={icon} />
      {label}
    </Link>
  );
}

function Icon({
  name,
  className = "size-[18px]",
}: {
  name: "dashboard" | "category" | "menu" | "profile" | "restaurant" | "check";
  className?: string;
}) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    category: (
      <>
        <path d="M20 13 13 20a2 2 0 0 1-3 0l-6-6a2 2 0 0 1 0-3l7-7h7a2 2 0 0 1 2 2Z" />
        <circle cx="15.5" cy="8.5" r="1" />
      </>
    ),
    menu: <path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" />,
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    restaurant: <path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" />,
    check: <path d="m5 12 4 4L19 6" />,
  };

  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
