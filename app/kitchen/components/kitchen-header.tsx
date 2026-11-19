import Link from "next/link";
import KitchenIcon from "./kitchen-icon";
import type { KitchenTheme } from "./use-kitchen-theme";

export default function KitchenHeader({
  isConnected,
  onThemeToggle,
  theme,
  title,
}: {
  isConnected: boolean;
  onThemeToggle: () => void;
  theme: KitchenTheme;
  title: string;
}) {
  return (
    <header className="k-topbar">
      <Link aria-label="Virtual Rudra Kitchen Dashboard" className="k-mobile-mark" href="/kitchen">
        <span aria-hidden="true" className="k-brand-mark">V</span>
      </Link>
      <div className="k-topbar-title">
        <small>VIRTUAL RUDRA / KITCHEN</small>
        <b>{title}</b>
      </div>
      <span className={`k-live ${isConnected ? "is-connected" : ""}`}>
        <i />
        {isConnected ? "Live service" : "Connecting"}
      </span>
      <button
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        className="k-theme-button"
        onClick={onThemeToggle}
        type="button"
      >
        <KitchenIcon name={theme === "dark" ? "sun" : "moon"} />
      </button>
    </header>
  );
}
