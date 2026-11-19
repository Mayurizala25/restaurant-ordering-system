import Link from "next/link";
import type { ReactNode } from "react";
import KitchenBottomNav from "./kitchen-bottom-nav";
import KitchenHeader from "./kitchen-header";
import KitchenIcon from "./kitchen-icon";
import type { KitchenTheme } from "./use-kitchen-theme";

export type KitchenView = "dashboard" | "history" | "detail";

export default function KitchenWorkspace({
  activeCount,
  children,
  currentView,
  isConnected,
  onThemeToggle,
  theme,
  title,
}: {
  activeCount: number;
  children: ReactNode;
  currentView: KitchenView;
  isConnected: boolean;
  onThemeToggle: () => void;
  theme: KitchenTheme;
  title: string;
}) {
  return (
    <div className="k-app" data-theme={theme}>
      <aside className="k-sidebar">
        <Link aria-label="Virtual Rudra Kitchen" className="k-brand" href="/kitchen">
          <span aria-hidden="true" className="k-brand-mark">V</span>
          <span className="k-brand-copy">
            <b>Virtual Rudra</b>
            <small>Restaurant OS</small>
          </span>
        </Link>

        <div className="k-venue">
          <span aria-hidden="true" className="k-venue-avatar">VR</span>
          <span className="k-venue-copy">
            <b>Virtual Rudra Kitchen</b>
            <small>{isConnected ? "Service is connected" : "Connecting to service"}</small>
          </span>
          <span
            aria-label={isConnected ? "Connected" : "Connecting"}
            className={`k-connection-dot ${isConnected ? "is-connected" : ""}`}
          />
        </div>

        <nav aria-label="Kitchen navigation" className="k-sidebar-nav">
          <Link
            aria-current={currentView === "dashboard" ? "page" : undefined}
            className={currentView === "dashboard" ? "active" : ""}
            href="/kitchen"
          >
            <KitchenIcon name="grid" />
            <span>Kitchen Dashboard</span>
            <em>{activeCount}</em>
          </Link>
          <Link
            aria-current={currentView === "history" ? "page" : undefined}
            className={currentView === "history" ? "active" : ""}
            href="/kitchen/history"
          >
            <KitchenIcon name="clock" />
            <span>Order History</span>
          </Link>
        </nav>

        <div className="k-sidebar-bottom">
          <button onClick={onThemeToggle} type="button">
            <KitchenIcon name={theme === "dark" ? "sun" : "moon"} />
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <Link href="/">
            <KitchenIcon name="arrow" />
            Return to restaurant OS
          </Link>
        </div>
      </aside>

      <section className="k-workspace">
        <KitchenHeader
          isConnected={isConnected}
          onThemeToggle={onThemeToggle}
          theme={theme}
          title={title}
        />
        {children}
      </section>

      {currentView !== "detail" && (
        <KitchenBottomNav activeView={currentView} />
      )}
    </div>
  );
}
