import Image from "next/image";
import Link from "next/link";
import KitchenIcon from "./kitchen-icon";

export type OrderStatus =
  | "received"
  | "accepted"
  | "preparing"
  | "ready"
  | "served"
  | "passed";
export type KitchenOrder = {
  id: string;
  table: number | null;
  area: string;
  elapsed: string;
  placedAt: string;
  createdAt: string;
  status: OrderStatus;
  items: { id: string; quantity: number; name: string; imageUrl: string }[];
  total?: string;
};

export default function KitchenOrderCard({
  order,
  onOpen,
  onStatusChange,
  historyHref,
  history = false,
  historyValue,
  isUpdating = false,
  canCancel = false,
}: {
  order: KitchenOrder;
  onOpen?: () => void;
  onStatusChange?: (id: string, status: OrderStatus) => void;
  historyHref?: string;
  history?: boolean;
  historyValue?: string;
  isUpdating?: boolean;
  canCancel?: boolean;
}) {
  const statusLabels: Record<OrderStatus, string> = {
    received: "Received",
    accepted: "Accepted",
    preparing: "Preparing",
    ready: "Ready",
    served: "Served / Completed",
    passed: "Cancelled",
  };
  const displayId = `#${order.id.slice(0, 8).toUpperCase()}`;
  const statusClass = `k-status-${order.status}`;
  const photos = order.items.slice(0, 2);

  const content = (
    <>
      <div aria-hidden="true" className="k-card-photos">
        {photos.length ? (
          photos.map((item) =>
            item.imageUrl ? (
              <Image
                alt=""
                height={160}
                key={item.id}
                src={item.imageUrl}
                unoptimized
                width={360}
              />
            ) : (
              <span className="k-card-photo-placeholder" key={item.id}>
                <KitchenIcon name="plate" size={28} />
              </span>
            ),
          )
        ) : (
          <span className="k-card-photo-placeholder">
            <KitchenIcon name="plate" size={28} />
          </span>
        )}
      </div>
      <div className="k-card-content">
        <div className="k-card-top">
          <span className={`k-status ${statusClass}`}>
            <i />
            {statusLabels[order.status]}
          </span>
          <span className="k-elapsed">
            <KitchenIcon name="clock" size={15} />
            {order.elapsed}
          </span>
        </div>
        <div className="k-card-title">
          <div>
            <small>ORDER</small>
            <h3>{displayId}</h3>
          </div>
          <div className="k-table-number">
            <small>TABLE</small>
            <strong>{order.table ?? "—"}</strong>
          </div>
        </div>
        {order.area && <p className="k-card-area">{order.area}</p>}
        <div className="k-items">
          {order.items.length ? (
            order.items.map((item) => (
              <div key={item.id}>
                <b>{item.quantity}×</b>
                <span>{item.name}</span>
              </div>
            ))
          ) : (
            <div className="k-items-empty">No items were recorded.</div>
          )}
        </div>
        {history ? (
          <div className="k-history-foot">
            <span>Placed {order.placedAt}</span>
            {historyValue && <strong>{historyValue}</strong>}
            <span className="k-history-link">
              View details <KitchenIcon name="arrow" size={15} />
            </span>
          </div>
        ) : (
          <div className="k-card-actions">
            {order.status === "received" ? (
              <>
                <button
                  className="k-secondary-action k-view-order"
                  onClick={onOpen}
                  type="button"
                >
                  View order
                </button>
                <button
                  className="k-primary-action"
                  disabled={isUpdating}
                  onClick={() => onStatusChange?.(order.id, "accepted")}
                  type="button"
                >
                  Accept order <KitchenIcon name="arrow" size={16} />
                </button>
                {canCancel && (
                  <button
                    className="k-secondary-action k-cancel-action"
                    disabled={isUpdating}
                    onClick={() => onStatusChange?.(order.id, "passed")}
                    type="button"
                  >
                    86 / Pass
                  </button>
                )}
              </>
            ) : order.status === "accepted" ? (
              <>
                <button className="k-secondary-action k-view-order" onClick={onOpen} type="button">
                  View order
                </button>
                <button
                  className="k-primary-action"
                  disabled={isUpdating}
                  onClick={() => onStatusChange?.(order.id, "preparing")}
                  type="button"
                >
                  Start preparation <KitchenIcon name="arrow" size={16} />
                </button>
              </>
            ) : order.status === "preparing" ? (
              <>
                <button className="k-secondary-action k-view-order" onClick={onOpen} type="button">
                  View order
                </button>
                <button
                  className="k-primary-action"
                  disabled={isUpdating}
                  onClick={() => onStatusChange?.(order.id, "ready")}
                  type="button"
                >
                  Mark ready <KitchenIcon name="arrow" size={16} />
                </button>
              </>
            ) : order.status === "ready" ? (
              <>
                <button className="k-secondary-action k-view-order" onClick={onOpen} type="button">
                  View order
                </button>
                <button
                  className="k-primary-action"
                  disabled={isUpdating}
                  onClick={() => onStatusChange?.(order.id, "served")}
                  type="button"
                >
                  Mark served <KitchenIcon name="arrow" size={16} />
                </button>
                <button
                  className="k-secondary-action"
                  disabled={isUpdating}
                  onClick={() => onStatusChange?.(order.id, "preparing")}
                  type="button"
                >
                  Return to prep
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </>
  );

  if (historyHref) {
    return (
      <Link
        aria-label={`Open order ${displayId} details`}
        className="k-order-card history-card"
        href={historyHref}
      >
        {content}
      </Link>
    );
  }

  return <article className="k-order-card">{content}</article>;
}
