"use client";

import KitchenIcon from "./kitchen-icon";

export default function KitchenConfirmationDialog({
  busy = false,
  onCancel,
  onConfirm,
  orderLabel,
}: {
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  orderLabel: string;
}) {
  return (
    <div
      className="k-confirm-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <section
        aria-labelledby="k-confirm-title"
        aria-modal="true"
        className="k-confirm"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <span aria-hidden="true" className="k-confirm-icon">
          <KitchenIcon name="check" size={26} />
        </span>
        <span className="k-eyebrow">COMPLETE ORDER</span>
        <h2 id="k-confirm-title">Mark this order as served?</h2>
        <p>
          {orderLabel} will leave the active dashboard and move to Order History.
        </p>
        <div>
          <button disabled={busy} onClick={onCancel} type="button">
            Keep active
          </button>
          <button disabled={busy} onClick={onConfirm} type="button">
            {busy ? "Saving…" : "Mark served"}
          </button>
        </div>
      </section>
    </div>
  );
}
