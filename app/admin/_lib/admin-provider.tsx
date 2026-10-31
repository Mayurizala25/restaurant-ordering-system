"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

type AdminNotification = {
  orderId: string;
  createdAt: string;
  tableNumber: number | null;
  isRead: boolean;
};

type StoredNotificationState = {
  knownOrderIds: string[];
  notifications: AdminNotification[];
};

type NotificationOrder = {
  id: string;
  created_at: string;
  restaurant_tables:
    | { table_number: number }
    | { table_number: number }[]
    | null;
};

type AdminContextValue = {
  signOut: () => Promise<void>;
  notifications: AdminNotification[];
  notificationsError: string;
  syncNotifications: (restaurantId: string, orders: NotificationOrder[]) => void;
  setNotificationsRead: (orderIds: string[], isRead: boolean) => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);
const NOTIFICATION_STORAGE_PREFIX = "virtual-rudra.admin.notifications.";
const RESTAURANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAdminNotification(value: unknown): value is AdminNotification {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    RESTAURANT_ID_PATTERN.test(value.orderId) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    (value.tableNumber === null ||
      (typeof value.tableNumber === "number" &&
        Number.isSafeInteger(value.tableNumber))) &&
    typeof value.isRead === "boolean"
  );
}

function readStoredNotifications(key: string): StoredNotificationState | null {
  const serialized = window.localStorage.getItem(key);
  if (serialized === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (cause) {
    throw new Error("Saved notifications could not be read.", { cause });
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.knownOrderIds) ||
    !value.knownOrderIds.every(
      (id) => typeof id === "string" && RESTAURANT_ID_PATTERN.test(id),
    ) ||
    !Array.isArray(value.notifications) ||
    !value.notifications.every(isAdminNotification) ||
    new Set(value.notifications.map((notification) => notification.orderId))
      .size !== value.notifications.length
  ) {
    throw new Error("Saved notifications have an invalid format.");
  }
  return {
    knownOrderIds: value.knownOrderIds,
    notifications: value.notifications,
  };
}

function writeStoredNotifications(
  key: string,
  state: StoredNotificationState,
): void {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, ...state }),
    );
  } catch (cause) {
    throw new Error("Notifications could not be saved in this browser.", {
      cause,
    });
  }
}

const formatNotificationTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [notificationsError, setNotificationsError] = useState("");
  const notificationRestaurantId = useRef<string | null>(null);

  const syncNotifications = useCallback(
    (restaurantId: string, orders: NotificationOrder[]) => {
      if (notificationRestaurantId.current !== restaurantId) {
        notificationRestaurantId.current = restaurantId;
        setNotifications([]);
      }

      try {
        const storageKey = `${NOTIFICATION_STORAGE_PREFIX}${restaurantId}`;
        const stored = readStoredNotifications(storageKey);
        const knownOrderIds = new Set(stored?.knownOrderIds ?? []);
        const nextNotifications = new Map(
          (stored?.notifications ?? []).map((notification) => [
            notification.orderId,
            notification,
          ]),
        );

        for (const order of orders) {
          if (nextNotifications.has(order.id)) continue;
          const table = Array.isArray(order.restaurant_tables)
            ? order.restaurant_tables[0]
            : order.restaurant_tables;
          nextNotifications.set(order.id, {
            orderId: order.id,
            createdAt: order.created_at,
            tableNumber: table?.table_number ?? null,
            isRead: stored === null || knownOrderIds.has(order.id),
          });
        }
        for (const order of orders) knownOrderIds.add(order.id);

        const nextList = [...nextNotifications.values()].sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        );
        writeStoredNotifications(storageKey, {
          knownOrderIds: [...knownOrderIds],
          notifications: nextList,
        });
        setNotifications(nextList);
        setNotificationsError("");
      } catch (cause) {
        setNotificationsError(
          cause instanceof Error
            ? cause.message
            : "Could not load saved notifications.",
        );
      }
    },
    [],
  );

  const setNotificationsRead = useCallback(
    (orderIds: string[], isRead: boolean) => {
      const restaurantId = notificationRestaurantId.current;
      if (!restaurantId) return;

      try {
        const key = `${NOTIFICATION_STORAGE_PREFIX}${restaurantId}`;
        const stored = readStoredNotifications(key);
        if (!stored) throw new Error("Saved notifications are unavailable.");

        const orderIdSet = new Set(orderIds);
        const nextNotifications = stored.notifications.map((notification) =>
          orderIdSet.has(notification.orderId)
            ? { ...notification, isRead }
            : notification,
        );
        writeStoredNotifications(key, {
          knownOrderIds: stored.knownOrderIds,
          notifications: nextNotifications,
        });
        setNotifications(nextNotifications);
        setNotificationsError("");
      } catch (cause) {
        setNotificationsError(
          cause instanceof Error
            ? cause.message
            : "Notifications could not be updated.",
        );
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      let validSession = false;
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
        });
        validSession = response.ok;
      } catch {
        validSession = false;
      }
      if (!active) return;
      setAuthenticated(validSession);
      setLoading(false);

      if (!validSession && pathname !== "/admin/login") {
        router.replace("/admin/login");
      } else if (validSession && pathname === "/admin/login") {
        router.replace("/admin/dashboard");
      }
    };

    const checkTimer = window.setTimeout(checkSession, 0);
    window.addEventListener("storage", checkSession);
    return () => {
      active = false;
      window.clearTimeout(checkTimer);
      window.removeEventListener("storage", checkSession);
    };
  }, [pathname, router]);

  useEffect(() => {
    const handleNotificationStorage = (event: StorageEvent) => {
      const restaurantId = notificationRestaurantId.current;
      if (!restaurantId) return;
      const key = `${NOTIFICATION_STORAGE_PREFIX}${restaurantId}`;
      if (event.key !== null && event.key !== key) return;

      try {
        const stored = readStoredNotifications(key);
        setNotifications(stored?.notifications ?? []);
        setNotificationsError("");
      } catch (cause) {
        setNotificationsError(
          cause instanceof Error
            ? cause.message
            : "Saved notifications could not be read.",
        );
      }
    };

    window.addEventListener("storage", handleNotificationStorage);
    return () =>
      window.removeEventListener("storage", handleNotificationStorage);
  }, []);

  const value: AdminContextValue = {
    notifications,
    notificationsError,
    syncNotifications,
    setNotificationsRead,
    signOut: async () => {
      const response = await fetch("/api/admin/session", {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Could not end the admin session.");
      }
      setAuthenticated(false);
      router.replace("/admin/login");
    },
  };

  const isLoginPage = pathname === "/admin/login";
  const content = loading ? (
    <div className="grid min-h-screen place-items-center bg-[#f5f6f2] text-sm text-[#535b55]">
      Checking demo session…
    </div>
  ) : isLoginPage && !authenticated ? (
    children
  ) : authenticated && !isLoginPage ? (
    <AdminShell>{children}</AdminShell>
  ) : (
    <div className="grid min-h-screen place-items-center bg-[#f5f6f2] text-sm text-[#535b55]">
      {authenticated ? "Opening admin dashboard…" : "Redirecting to demo login…"}
    </div>
  );

  return <AdminContext.Provider value={value}>{content}</AdminContext.Provider>;
}

const adminNavigation = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "dashboard" },
  { label: "Categories", href: "/admin/categories", icon: "categories" },
  { label: "Menu Items", href: "/admin/menu-items", icon: "menu" },
  { label: "Tables", href: "/admin/tables", icon: "tables" },
  { label: "Feedback", href: "/admin/feedback", icon: "feedback" },
  { label: "Analytics", href: "/admin/analytics", icon: "analytics" },
  { label: "Profile", href: "/admin/profile", icon: "profile" },
] as const;

function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    signOut,
    notifications,
    notificationsError,
    setNotificationsRead,
  } = useAdmin();
  const [logoutError, setLogoutError] = useState("");

  async function handleSignOut() {
    setLogoutError("");
    try {
      await signOut();
    } catch (cause) {
      setLogoutError(
        cause instanceof Error ? cause.message : "Could not sign out.",
      );
    }
  }

  return (
    <div className="vr-admin-theme">
      <div className="vr-admin-workspace">
        <aside aria-label="Admin sidebar" className="vr-admin-sidebar">
          <Link className="vr-admin-brand" href="/admin/dashboard">
            <Image
              alt=""
              className="vr-admin-brand-mark"
              height={40}
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={40}
            />
            <span>
              <strong>Virtual Rudra</strong>
              <small>Restaurant Admin</small>
            </span>
          </Link>
          <p className="vr-admin-nav-caption">WORKSPACE</p>
          <nav aria-label="Admin navigation" className="vr-admin-nav">
            {adminNavigation.map((item) => (
              <Link
                aria-label={item.label}
                aria-current={pathname === item.href ? "page" : undefined}
                className={pathname === item.href ? "is-active" : ""}
                href={item.href}
                key={item.href}
                title={item.label}
              >
                <AdminNavIcon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            aria-label="Sign out"
            className="vr-admin-logout"
            onClick={() => void handleSignOut()}
            title="Sign out"
            type="button"
          >
            <AdminNavIcon name="logout" />
            Sign out
          </button>
        </aside>

        <div className="vr-admin-main">
          <header className="vr-admin-header">
            <div className="vr-admin-header-actions">
              <AdminNotificationBell
                notifications={notifications}
                notificationsError={notificationsError}
                setNotificationsRead={setNotificationsRead}
              />
              <span className="vr-admin-demo-status">
                <i aria-hidden="true" />
                Secure session
              </span>
            </div>
          </header>
          <div className="vr-admin-content">{children}</div>
          {logoutError && <p className="vr-admin-error" role="alert">{logoutError}</p>}
        </div>

        <nav aria-label="Mobile admin navigation" className="vr-admin-bottom-nav">
          {adminNavigation.map((item) => (
            <Link
              aria-current={pathname === item.href ? "page" : undefined}
              className={pathname === item.href ? "is-active" : ""}
              href={item.href}
              key={item.href}
            >
              <AdminNavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
          <button onClick={() => void handleSignOut()} type="button">
            <AdminNavIcon name="logout" />
            <span>Logout</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

function AdminNavIcon({
  name,
}: {
  name:
    | "dashboard"
    | "categories"
    | "menu"
    | "tables"
    | "feedback"
    | "analytics"
    | "profile"
    | "logout";
}) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    categories: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="8" cy="5" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="10" cy="19" r="1.5" /></>,
    menu: <><path d="M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5" /></>,
    tables: <><rect x="3" y="4" width="18" height="7" rx="2" /><path d="M7 11v9m10-9v9M3 16h18" /></>,
    feedback: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.5A7.5 7.5 0 1 1 20 11.5Z" /><path d="m8 11 2.5 2.5L16 8" /></>,
    analytics: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="vr-admin-nav-icon"
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

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error("useAdmin must be used within AdminProvider.");
  }
  return value;
}

function AdminNotificationBell({
  notifications,
  notificationsError,
  setNotificationsRead,
}: {
  notifications: AdminNotification[];
  notificationsError: string;
  setNotificationsRead: (orderIds: string[], isRead: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter(
    (notification) => !notification.isRead,
  ).length;

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="vr-admin-notification" ref={dropdownRef}>
      <button
        aria-controls="admin-notifications-dropdown"
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className="vr-admin-notification-trigger"
        onClick={() => setIsOpen((open) => !open)}
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
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {unreadCount > 0 && (
          <span className="vr-admin-notification-count">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {isOpen && (
        <section
          aria-label="Recent order notifications"
          className="vr-admin-notification-dropdown"
          id="admin-notifications-dropdown"
        >
          <div className="vr-admin-notification-heading">
            <div>
              <strong>Notifications</strong>
              <span>
                {unreadCount
                  ? `${unreadCount} unread`
                  : "Recent orders"}
              </span>
            </div>
            {unreadCount > 0 && (
              <button
                className="vr-admin-notification-mark-all"
                onClick={() =>
                  setNotificationsRead(
                    notifications
                      .filter((notification) => !notification.isRead)
                      .map((notification) => notification.orderId),
                    true,
                  )
                }
                type="button"
              >
                Mark all read
              </button>
            )}
          </div>
          {notificationsError && (
            <p className="vr-admin-notification-error" role="alert">
              {notificationsError}
            </p>
          )}
          {notifications.length === 0 ? (
            <p className="vr-admin-notification-empty">No recent orders.</p>
          ) : (
            <ul className="vr-admin-notification-list">
              {notifications.slice(0, 10).map((notification) => (
                <li key={notification.orderId}>
                  <Link
                    className="vr-admin-notification-order"
                    href={`/admin/dashboard#order-${notification.orderId}`}
                    onClick={() => {
                      setNotificationsRead([notification.orderId], true);
                      setIsOpen(false);
                    }}
                  >
                    <span
                      aria-label={notification.isRead ? "Read" : "Unread"}
                      className={`vr-admin-notification-indicator${notification.isRead ? "" : " is-unread"}`}
                    />
                    <span className="vr-admin-notification-order-details">
                      <strong title={`Order ${notification.orderId}`}>
                        Order #{notification.orderId.slice(0, 8).toUpperCase()}
                      </strong>
                      <span>
                        Table {notification.tableNumber ?? "—"} ·{" "}
                        {Number.isNaN(Date.parse(notification.createdAt))
                          ? "Time unavailable"
                          : formatNotificationTime.format(
                              new Date(notification.createdAt),
                            )}
                      </span>
                    </span>
                    <span className="vr-admin-notification-read-state">
                      {notification.isRead ? "Read" : "Unread"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export function SignOutButton() {
  const { signOut } = useAdmin();
  const router = useRouter();
  const [error, setError] = useState("");

  async function handleSignOut() {
    setError("");
    try {
      await signOut();
      router.replace("/admin/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }

  return (
    <div>
      <button
        className="rounded-lg border border-[#e5e8e2] px-3 py-2 text-xs font-medium text-[#535b55] hover:border-[#185c43] hover:text-[#185c43]"
        onClick={() => void handleSignOut()}
        type="button"
      >
        Sign out
      </button>
      {error && (
        <span className="ml-2 text-xs text-[#a3423c]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
