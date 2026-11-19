import Link from "next/link";
import KitchenIcon from "./kitchen-icon";

export type KitchenView = "dashboard" | "history";

export default function KitchenBottomNav({
  activeView,
}: {
  activeView: KitchenView;
}) {
  return (
    <nav aria-label="Kitchen views" className="k-mobile-nav">
      <Link
        aria-current={activeView === "dashboard" ? "page" : undefined}
        className={activeView === "dashboard" ? "active" : ""}
        href="/kitchen"
      >
        <KitchenIcon name="grid" />
        Dashboard
      </Link>
      <Link
        aria-current={activeView === "history" ? "page" : undefined}
        className={activeView === "history" ? "active" : ""}
        href="/kitchen/history"
      >
        <KitchenIcon name="clock" />
        History
      </Link>
      <Link href="/">
        <KitchenIcon name="arrow" />
        Restaurant
      </Link>
    </nav>
  );
}
