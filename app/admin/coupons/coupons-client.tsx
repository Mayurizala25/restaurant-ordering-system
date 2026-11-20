"use client";

import { FormEvent, useEffect, useState } from "react";

type Coupon = {
  id: string;
  code: string;
  name: string;
  discount_type: "percentage" | "fixed";
  discount_value: number | string;
  expiry_date: string | null;
  minimum_order_value: number | string;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
};

const emptyForm: {
  code: string;
  name: string;
  discountType: "percentage" | "fixed";
  discountValue: string;
  expiryDate: string;
  minimumOrderValue: string;
  usageLimit: string;
} = {
  code: "",
  name: "",
  discountType: "percentage",
  discountValue: "",
  expiryDate: "",
  minimumOrderValue: "0",
  usageLimit: "",
};

export default function AdminCouponsClient() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/coupons", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== "object" || payload === null || !("coupons" in payload) || !Array.isArray(payload.coupons)) throw new Error("Could not load coupons.");
      setCoupons(payload.coupons as Coupon[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load coupons.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    const discountValue = Number(form.discountValue);
    const minimumOrderValue = Number(form.minimumOrderValue);
    const usageLimit = form.usageLimit === "" ? null : Number(form.usageLimit);
    if (!form.code.trim() || !Number.isFinite(discountValue) || discountValue < 0 || (form.discountType === "percentage" && discountValue > 100) || !Number.isFinite(minimumOrderValue) || minimumOrderValue < 0 || (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1))) {
      setError("Enter valid coupon fields.");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/admin/coupons", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id: editingId,
          code: form.code,
          name: form.name,
          discountType: form.discountType,
          discountValue,
          expiryDate: form.expiryDate || null,
          minimumOrderValue,
          usageLimit,
          isActive: true,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Could not save coupon.");
      setMessage(editingId ? "Coupon updated." : "Coupon created.");
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save coupon.");
    } finally {
      setSaving(false);
    }
  };

  const edit = (coupon: Coupon) => {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      name: coupon.name,
      discountType: coupon.discount_type,
      discountValue: String(coupon.discount_value),
      expiryDate: coupon.expiry_date ?? "",
      minimumOrderValue: String(coupon.minimum_order_value),
      usageLimit: coupon.usage_limit === null ? "" : String(coupon.usage_limit),
    });
  };

  const disable = async (coupon: Coupon) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/coupons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id: coupon.id,
          code: coupon.code,
          name: coupon.name,
          discountType: coupon.discount_type,
          discountValue: Number(coupon.discount_value),
          expiryDate: coupon.expiry_date,
          minimumOrderValue: Number(coupon.minimum_order_value),
          usageLimit: coupon.usage_limit,
          isActive: false,
        }),
      });
      if (!response.ok) throw new Error("Could not disable coupon.");
      setMessage("Coupon disabled.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disable coupon.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="vr-admin-management-page">
      <header className="vr-admin-management-header">
        <div>
          <p className="vr-admin-management-kicker">OFFERS</p>
          <h1>Coupons</h1>
        </div>
      </header>
      <section className="mb-6 rounded-[14px] border border-[#e5e8e2] bg-white p-5">
        <h2 className="font-bold">{editingId ? "Edit coupon" : "Create coupon"}</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={submit}>
          <label className="grid gap-1 text-xs">Code<input className="rounded border px-3 py-2" maxLength={32} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase()})} required /></label>
          <label className="grid gap-1 text-xs">Name<input className="rounded border px-3 py-2" maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="grid gap-1 text-xs">Discount type<select className="rounded border px-3 py-2" value={form.discountType} onChange={(event) => setForm({ ...form, discountType: event.target.value as "percentage" | "fixed" })}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>
          <label className="grid gap-1 text-xs">Discount value<input className="rounded border px-3 py-2" min="0" max={form.discountType === "percentage" ? "100" : undefined} step="0.01" type="number" value={form.discountValue} onChange={(event) => setForm({ ...form, discountValue: event.target.value })} required /></label>
          <label className="grid gap-1 text-xs">Expiry date<input className="rounded border px-3 py-2" type="date" value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} /></label>
          <label className="grid gap-1 text-xs">Minimum order value<input className="rounded border px-3 py-2" min="0" step="0.01" type="number" value={form.minimumOrderValue} onChange={(event) => setForm({ ...form, minimumOrderValue: event.target.value })} required /></label>
          <label className="grid gap-1 text-xs">Usage limit (optional)<input className="rounded border px-3 py-2" min="1" step="1" type="number" value={form.usageLimit} onChange={(event) => setForm({ ...form, usageLimit: event.target.value })} /></label>
          <div className="flex items-end gap-2"><button className="rounded bg-[#185c43] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? "Saving…" : editingId ? "Save changes" : "Create coupon"}</button>{editingId && <button className="rounded border px-4 py-2 text-sm" type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</button>}</div>
        </form>
        {message && <p className="mt-3 text-xs text-[#185c43]" role="status">{message}</p>}
        {error && <p className="mt-3 text-xs text-[#a3423c]" role="alert">{error}</p>}
      </section>
      <section className="grid gap-3">
        {loading ? <p className="text-sm text-muted">Loading coupons…</p> : coupons.map((coupon) => (
          <article className="rounded-[14px] border border-[#e5e8e2] bg-white p-4" key={coupon.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><strong>{coupon.code}</strong>{coupon.name && <span className="ml-2 text-sm text-muted">{coupon.name}</span>}<p className="mt-1 text-xs text-muted">{coupon.discount_type === "percentage" ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`} · Min ₹{coupon.minimum_order_value} · Used {coupon.used_count}{coupon.usage_limit === null ? "" : ` / ${coupon.usage_limit}`} · {coupon.expiry_date ? `Expires ${coupon.expiry_date}` : "No expiry"}</p></div>
              <div className="flex gap-2"><button className="rounded border px-3 py-1.5 text-xs" type="button" onClick={() => edit(coupon)}>Edit</button>{coupon.is_active && <button className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700" disabled={saving} type="button" onClick={() => void disable(coupon)}>Disable</button>}</div>
            </div>
            {!coupon.is_active && <p className="mt-2 text-xs text-muted">Disabled</p>}
          </article>
        ))}
        {!loading && coupons.length === 0 && <p className="text-sm text-muted">No coupons created yet.</p>}
      </section>
    </main>
  );
}
