import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import * as Print from "expo-print";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import virtualRudraLogo from "./assets/virtual-rudra-logo.png";
import { getQrDestination, SITE_ORIGIN, SITE_URL } from "./qr";

const WEBVIEW_LOAD_TIMEOUT_MS = 30_000;
function getPrivateDevelopmentHost(hostUri: string | undefined): string | null {
  if (!hostUri) return null;

  let host: string;
  try {
    host = hostUri.includes("://")
      ? new URL(hostUri).hostname
      : hostUri.split("/")[0].replace(/:\d+$/, "");
  } catch {
    return null;
  }

  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  const [first, second] = octets;
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
    ? host
    : null;
}

const developmentHost =
  getPrivateDevelopmentHost(Constants.expoConfig?.hostUri) ??
  getPrivateDevelopmentHost(Constants.expoGoConfig?.debuggerHost) ??
  getPrivateDevelopmentHost(Constants.linkingUri) ??
  getPrivateDevelopmentHost(Constants.manifest2?.launchAsset.url);
const developmentBaseUrl = developmentHost
  ? `http://${developmentHost}:3000/`
  : null;
const configuredBaseUrl = process.env.EXPO_PUBLIC_WEBVIEW_URL?.trim();
const WEBVIEW_BASE_URL =
  configuredBaseUrl || (__DEV__ ? developmentBaseUrl : SITE_URL);
const WEBVIEW_SETUP_ERROR =
  __DEV__ && !WEBVIEW_BASE_URL
    ? "Expo did not advertise a private LAN IPv4 address. Restart Metro with `npm run start` from mobile/ and scan that session's current QR code. You can also set EXPO_PUBLIC_WEBVIEW_URL before starting Expo."
    : "";
const WEBVIEW_START_URL = WEBVIEW_BASE_URL
  ? new URL("/", WEBVIEW_BASE_URL).toString()
  : "";
const WEBVIEW_ORIGIN = WEBVIEW_BASE_URL
  ? new URL(WEBVIEW_START_URL).origin
  : "";
const WEBVIEW_ORIGINS = new Set(
  [SITE_ORIGIN, WEBVIEW_ORIGIN].filter((origin) => origin.length > 0),
);
const WEBVIEW_ORIGIN_WHITELIST = Array.from(
  WEBVIEW_ORIGINS,
  (origin) => `${origin}/*`,
);

function getConnectionErrorMessage(detail?: string) {
  const isLocalNextServer =
    __DEV__ &&
    developmentBaseUrl !== null &&
    WEBVIEW_ORIGIN === new URL(developmentBaseUrl).origin;
  const message = isLocalNextServer
    ? `Could not connect to the local Next.js server at ${WEBVIEW_ORIGIN}. Make sure \`npm run dev\` is running and your phone is on the same Wi-Fi, then try again.`
    : "Could not connect to the Virtual Rudra website. Check your connection and try again.";
  return detail ? `${message} (${detail})` : message;
}

const navigation = [
  { label: "Dashboard", path: "/admin/dashboard", icon: "▦" },
  { label: "Categories", path: "/admin/categories", icon: "◇" },
  { label: "Menu Items", path: "/admin/menu-items", icon: "≋" },
  { label: "Tables", path: "/admin/tables", icon: "▤" },
  { label: "Orders", path: "/admin/dashboard#recent-orders-heading", icon: "▣" },
  { label: "Feedback", path: "/admin/feedback", icon: "◌" },
  { label: "Analytics", path: "/admin/analytics", icon: "⌁" },
] as const;

const webViewAdminChromeStyles = `
  .vr-admin-theme .vr-admin-header,
  .vr-admin-theme .vr-admin-bottom-nav,
  .vr-admin-theme .vr-admin-mobile-scrim,
  .vr-admin-theme .vr-admin-theme-toggle {
    display: none !important;
  }
  .vr-admin-theme .vr-admin-content > main.vr-admin-route-page,
  .vr-admin-theme .vr-admin-content .vr-admin-management-page {
    padding-bottom: max(24px, env(safe-area-inset-bottom)) !important;
  }
`;

const webViewManagementMobileStyles = `
  @media (max-width: 640px) {
    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    .vr-admin-theme:is([data-expo-admin-page="/admin/categories"], [data-expo-admin-page="/admin/menu-items"], [data-expo-admin-page="/admin/tables"]) .vr-admin-management-page {
      color: var(--text);
    }

    .vr-admin-theme:is([data-expo-admin-page="/admin/categories"], [data-expo-admin-page="/admin/menu-items"], [data-expo-admin-page="/admin/tables"]) .vr-admin-management-page :is(input, textarea, select) {
      max-width: 100%;
      border-color: var(--border-strong);
      background-color: var(--surface);
      color: var(--text);
      color-scheme: inherit;
    }

    .vr-admin-theme:is([data-expo-admin-page="/admin/categories"], [data-expo-admin-page="/admin/menu-items"], [data-expo-admin-page="/admin/tables"]) .vr-admin-management-page :is(input, textarea, select)::placeholder {
      color: var(--muted);
      opacity: 1;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page table,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page table,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page table {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      table-layout: auto !important;
      border-collapse: separate !important;
      border-spacing: 0 !important;
      overflow: visible !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page thead,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page thead,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page thead {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      clip-path: inset(50%) !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page thead tr,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page thead tr,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page thead tr {
      display: block !important;
      width: 1px !important;
      height: 1px !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page thead th,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page thead th,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page thead th {
      display: block !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      overflow: hidden !important;
      border: 0 !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) !important;
      gap: 10px !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody tr,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody tr,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody tr {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) !important;
      width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
      padding: 8px 12px !important;
      overflow: hidden !important;
      border: 1px solid var(--admin-border) !important;
      border-radius: 16px !important;
      background: var(--admin-surface) !important;
      color: var(--admin-text) !important;
      box-shadow: var(--shadow);
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody td,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody td,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody td {
      display: grid !important;
      grid-template-columns: minmax(76px, 0.38fr) minmax(0, 1fr);
      align-items: start;
      gap: 10px;
      min-width: 0;
      box-sizing: border-box !important;
      padding: 9px 0 !important;
      border-bottom: 1px solid var(--admin-border) !important;
      color: var(--admin-text);
      text-align: left !important;
      white-space: normal !important;
      word-break: normal !important;
      overflow-wrap: anywhere !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody td::before,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody td::before,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody td::before {
      content: attr(data-expo-mobile-label);
      color: var(--admin-muted);
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.4;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody td[data-expo-mobile-actions],
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody td[data-expo-mobile-actions],
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody td[data-expo-mobile-actions] {
      display: flex !important;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 0 3px !important;
      border-bottom: 0 !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody td[data-expo-mobile-actions]::before,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody td[data-expo-mobile-actions]::before,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody td[data-expo-mobile-actions]::before {
      margin-right: auto;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody td[data-expo-mobile-actions] button,
    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page tbody td[data-expo-mobile-actions] a,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody td[data-expo-mobile-actions] button,
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page tbody td[data-expo-mobile-actions] a,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody td[data-expo-mobile-actions] button,
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page tbody td[data-expo-mobile-actions] a {
      min-width: 40px;
      min-height: 40px;
      max-width: 100%;
      white-space: normal;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page :is(article, [role="article"]) {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: 16px;
      background: var(--admin-surface);
      color: var(--admin-text);
      box-shadow: var(--shadow);
    }

    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page :is(article, [role="article"]) :is(h2, h3, p, strong) {
      color: var(--admin-text);
    }

    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page :is(article, [role="article"]) img {
      width: 64px;
      height: 64px;
      max-width: 100%;
      flex: none;
      border-radius: 12px;
      object-fit: cover;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page :is(article, [role="article"]) :is(button, [role="button"]) {
      min-height: 40px;
      max-width: 100%;
      white-space: normal;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-table-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 8px !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-table-card-actions {
      grid-template-columns: minmax(0, 1fr) 40px 40px !important;
      gap: 8px !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-table-qr-dialog {
      max-height: calc(100dvh - 20px) !important;
    }

    .vr-admin-theme[data-expo-admin-page="/admin/categories"] .vr-admin-management-page :is(button, [role="button"]),
    .vr-admin-theme[data-expo-admin-page="/admin/menu-items"] .vr-admin-management-page :is(button, [role="button"]),
    .vr-admin-theme[data-expo-admin-page="/admin/tables"] .vr-admin-management-page :is(button, [role="button"]) {
      max-width: 100%;
      white-space: normal;
    }

    @media (max-width: 430px) {
      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        align-items: stretch;
        gap: 6px !important;
        margin-bottom: 12px;
      }

      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-card {
        min-height: 108px !important;
        flex-direction: column !important;
        justify-content: space-between;
        gap: 6px !important;
        border-radius: 12px;
        padding: 8px !important;
      }

      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-icon {
        width: 26px;
        height: 26px;
        border-radius: 8px;
      }

      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-icon svg {
        width: 14px;
        height: 14px;
      }

      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-copy {
        width: 100%;
        gap: 2px;
      }

      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-copy p,
      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-copy span {
        font-size: 8px;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }

      .vr-admin-theme:is([data-expo-admin-page="/admin/feedback"], [data-expo-admin-page="/admin/analytics"]) .vr-admin-metric-copy strong {
        font-size: 18px;
        line-height: 1;
      }
    }
  }
`;

function getWebViewAppearanceScript() {
  return `(() => {
    const install = () => {
      const parent = document.head || document.documentElement;
      if (!parent) return;
      const root = document.querySelector('.vr-admin-theme');
      const loginRoot = document.querySelector('.vr-admin-login');
      const themeRoot = root || loginRoot;
      const kitchenRoot = document.querySelector('.page[data-theme], .historyPage[data-theme], .detailPage[data-theme]');
      const path = location.pathname.replace(/\\/$/, '') || '/';
      const managementPages = ['/admin/categories', '/admin/menu-items', '/admin/tables'];
      if (root) root.setAttribute('data-expo-admin-page', path);
      let storedTheme = null;
      try {
        storedTheme = localStorage.getItem('vr-admin-theme');
      } catch {
        storedTheme = null;
      }
      const rootTheme = themeRoot?.getAttribute('data-admin-theme');
      const currentTheme = storedTheme === 'dark' || storedTheme === 'light'
        ? storedTheme
        : rootTheme;
      if (currentTheme === 'dark' || currentTheme === 'light') {
        const themeReady = currentTheme === rootTheme;
        const bridgeState = currentTheme + ':' + themeReady;
        if (window.__virtualRudraExpoAdminTheme !== bridgeState) {
          window.__virtualRudraExpoAdminTheme = bridgeState;
          window.ReactNativeWebView?.postMessage(JSON.stringify({
            type: 'virtual-rudra:admin-theme',
            theme: currentTheme,
            ready: themeReady
          }));
        }
      }
      const kitchenTheme = kitchenRoot?.getAttribute('data-theme');
      if (path === '/kitchen' || path.startsWith('/kitchen/')) {
        if (kitchenTheme === 'dark' || kitchenTheme === 'light') {
          if (window.__virtualRudraExpoKitchenTheme !== kitchenTheme) {
            window.__virtualRudraExpoKitchenTheme = kitchenTheme;
            window.ReactNativeWebView?.postMessage(JSON.stringify({
              type: 'virtual-rudra:kitchen-theme',
              theme: kitchenTheme
            }));
          }
        }
      }
      const styleId = 'virtual-rudra-expo-admin-chrome';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        parent.appendChild(style);
      }
      const styles = ${JSON.stringify(webViewAdminChromeStyles + webViewManagementMobileStyles)};
      if (style.textContent !== styles) style.textContent = styles;
      if (root && managementPages.includes(path)) {
        root.querySelectorAll('.vr-admin-management-page table').forEach((table) => {
          const headers = Array.from(table.querySelectorAll('thead tr:first-child th, thead tr:first-child td'));
          table.querySelectorAll('tbody tr').forEach((row) => {
            Array.from(row.children).forEach((cell, index) => {
              if (!(cell instanceof HTMLElement) || cell.tagName !== 'TD') return;
              const label = headers[index]?.textContent?.trim().replace(/\\s+/g, ' ') || 'Details';
              if (cell.getAttribute('data-expo-mobile-label') !== label) {
                cell.setAttribute('data-expo-mobile-label', label);
              }
              const hasActions = Boolean(cell.querySelector('button, a, [role="button"]'));
              if (hasActions && !cell.hasAttribute('data-expo-mobile-actions')) {
                cell.setAttribute('data-expo-mobile-actions', '');
              } else if (!hasActions && cell.hasAttribute('data-expo-mobile-actions')) {
                cell.removeAttribute('data-expo-mobile-actions');
              }
            });
          });
        });
      }
      if (!window.__virtualRudraExpoThemeObserver && document.documentElement) {
        window.__virtualRudraExpoThemeObserver = new MutationObserver(install);
        window.__virtualRudraExpoThemeObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-admin-theme', 'data-theme'],
        });
      }
    };
    install();
    if (location.hash === '#recent-orders-heading') {
      requestAnimationFrame(() => document.getElementById('recent-orders-heading')?.scrollIntoView({ block: 'start' }));
    }
    return true;
  })(); true;`;
}

function getStoredAdminThemeScript() {
  return `(() => {
    if (!location.pathname.startsWith('/admin')) return true;
    try {
      const theme = localStorage.getItem('vr-admin-theme');
      if (theme === 'dark' || theme === 'light') {
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: 'virtual-rudra:admin-theme',
          theme
        }));
      }
    } catch {
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'virtual-rudra:admin-theme-error'
      }));
    }
    return true;
  })(); true;`;
}

type AdminTheme = "dark" | "light";

const lightColors = {
  background: "#f5f3ed",
  surface: "#fffefb",
  surfaceRaised: "#ffffff",
  surfaceSubtle: "#eeece5",
  text: "#16201d",
  muted: "#6e7671",
  border: "#deddd6",
  accent: "#c26d3a",
  activeSurface: "#e5ece4",
  activeIcon: "#dce8dc",
  danger: "#a44a3f",
  scrim: "rgba(19, 32, 28, 0.42)",
  shadow: "#13201c",
};

const darkColors = {
  background: "#111714",
  surface: "#18201c",
  surfaceRaised: "#18201c",
  surfaceSubtle: "#202a25",
  text: "#f0eee7",
  muted: "#9ca69f",
  border: "#2d3832",
  accent: "#e08b55",
  activeSurface: "#24332a",
  activeIcon: "#2d4033",
  danger: "#e28679",
  scrim: "rgba(0, 0, 0, 0.62)",
  shadow: "#000000",
};

const kitchenDarkColors = {
  ...darkColors,
  background: "#16201d",
  surface: "#202b26",
  surfaceRaised: "#24302a",
  surfaceSubtle: "#1b2621",
  text: "#f5f3ed",
  muted: "#b6c0b7",
  border: "#344139",
  accent: "#c26d3a",
};

function getPath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

function getSameOriginUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return WEBVIEW_ORIGINS.has(parsedUrl.origin) ? parsedUrl.href : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function App() {
  const webView = useRef<WebView<object> | null>(null);
  const scanned = useRef(false);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const [webViewKey, setWebViewKey] = useState(0);
  const retryUrl = useRef(WEBVIEW_START_URL);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoading = useRef(false);
  const webViewLoaded = useRef(false);
  const loadFailed = useRef(false);
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.86, 360);
  const [url, setUrl] = useState(WEBVIEW_START_URL);
  const [currentPath, setCurrentPath] = useState(getPath(WEBVIEW_START_URL));
  const [canGoBack, setCanGoBack] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const [adminTheme, setAdminTheme] = useState<AdminTheme>("dark");
  const [kitchenTheme, setKitchenTheme] = useState<AdminTheme>("dark");
  const isKitchenPage = currentPath === "/kitchen" || currentPath.startsWith("/kitchen/");
  const activeTheme = isKitchenPage
    ? kitchenTheme
    : currentPath.startsWith("/admin")
      ? adminTheme
      : "light";
  const colors = isKitchenPage
    ? activeTheme === "dark" ? kitchenDarkColors : lightColors
    : activeTheme === "dark" ? darkColors : lightColors;

  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    const messageUrl = event.nativeEvent.url;
    const sourceUrl = getSameOriginUrl(messageUrl);
    if (messageUrl && !sourceUrl) return;
    const sourcePath = sourceUrl ? new URL(sourceUrl).pathname : currentPath;

    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (
      sourcePath.startsWith("/admin") &&
      message.type === "virtual-rudra:admin-theme-error"
    ) {
      setLoadError("The saved admin theme could not be read from this browser.");
      return;
    }
    if (
      sourcePath.startsWith("/admin") &&
      message.type === "virtual-rudra:admin-theme" &&
      (message.theme === "dark" || message.theme === "light")
    ) {
      setAdminTheme(message.theme);
      return;
    }
    if (
      sourcePath.startsWith("/kitchen") &&
      message.type === "virtual-rudra:kitchen-theme" &&
      (message.theme === "dark" || message.theme === "light")
    ) {
      setKitchenTheme(message.theme);
      return;
    }
    const isInvoicePrint =
      sourceUrl !== null &&
      sourcePath.startsWith("/invoice/") &&
      message.type === "virtual-rudra:print-invoice" &&
      typeof message.html === "string" &&
      message.html.includes("vr-invoice-document");
    const isTableQrPrint =
      sourceUrl !== null &&
      sourcePath === "/admin/tables" &&
      message.type === "virtual-rudra:print-table-qr" &&
      typeof message.html === "string" &&
      message.html.includes("vr-table-qr-print");
    if (
      (!isInvoicePrint && !isTableQrPrint) ||
      typeof message.html !== "string" ||
      message.html.length > 150_000
    ) {
      return;
    }

    void Print.printAsync({ html: message.html }).catch((cause: unknown) => {
      setLoadError(
        cause instanceof Error
          ? `${isTableQrPrint ? "Table QR card" : "Invoice"} could not be opened for printing: ${cause.message}`
          : `${isTableQrPrint ? "Table QR card" : "Invoice"} could not be opened for printing.`,
      );
    });
  }, [currentPath]);

  function toggleAdminTheme() {
    const nextTheme = adminTheme === "dark" ? "light" : "dark";
    setAdminTheme(nextTheme);
    webView.current?.injectJavaScript(
      `(() => {
        const themeEvent = new CustomEvent('virtual-rudra:toggle-admin-theme', {
          detail: { theme: '${nextTheme}' },
          cancelable: true
        });
        window.dispatchEvent(themeEvent);
        if (!themeEvent.defaultPrevented) {
          document.querySelector('.vr-admin-theme-toggle')?.click();
        }
      })(); true;`,
    );
  }

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = null;
  }, []);

  const startLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    loadTimeout.current = setTimeout(() => {
      loadTimeout.current = null;
      isLoading.current = false;
      webViewLoaded.current = false;
      webView.current?.stopLoading();
      setLoadError(getConnectionErrorMessage("Connection timed out after 30 seconds"));
    }, WEBVIEW_LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        clearLoadTimeout();
        return;
      }
      if (isLoading.current && !webViewLoaded.current) startLoadTimeout();
    });

    return () => {
      subscription.remove();
      clearLoadTimeout();
    };
  }, [clearLoadTimeout, startLoadTimeout]);

  useEffect(() => {
    Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: drawerOpen ? 250 : 190,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, drawerProgress]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scanning) {
        setScanning(false);
        return true;
      }
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (canGoBack) {
        webView.current?.goBack();
        return true;
      }
      if (currentPath.startsWith("/kitchen")) {
        const homeUrl = new URL("/", WEBVIEW_ORIGIN).toString();
        setCurrentPath("/");
        setUrl(homeUrl);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack, currentPath, drawerOpen, scanning]);

  function openScanner() {
    scanned.current = false;
    setScanError("");
    setScanning(true);
    if (!permission?.granted) void requestPermission();
  }

  function handleScan(data: string) {
    if (scanned.current) return;
    scanned.current = true;
    const destination = getQrDestination(
      data,
      __DEV__ ? WEBVIEW_ORIGIN : undefined,
    );
    if (!destination) {
      setScanError("This QR code is not a valid Virtual Rudra customer or admin link.");
      return;
    }

    setLoadError("");
    setUrl(destination);
    setCurrentPath(getPath(destination));
    setScanning(false);
  }

  function navigateTo(path: string) {
    setDrawerOpen(false);
    setLoadError("");
    const destination = new URL(path, WEBVIEW_ORIGIN).toString();
    setCurrentPath(getPath(destination));
    setUrl(destination);
  }

  function retryWebView() {
    clearLoadTimeout();
    webViewLoaded.current = false;
    isLoading.current = true;
    setLoadError("");
    setUrl(retryUrl.current);
    setWebViewKey((key) => key + 1);
  }

  function signOut() {
    setDrawerOpen(false);
    webView.current?.injectJavaScript(
      "document.querySelector('.vr-admin-logout')?.click(); true;",
    );
  }

  const activePage = navigation.find(
    (item) => item.path.split("#")[0] === currentPath,
  )?.label;
  const pageTitle =
    currentPath.startsWith("/admin") ? activePage ?? "Admin workspace" : "Virtual Rudra";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={scanning || activeTheme === "dark" ? "light-content" : "dark-content"}
      />
      {currentPath.startsWith("/admin") && currentPath !== "/admin/login" && (
        <View
          style={[
            styles.header,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
          ]}
        >
          <Pressable
            accessibilityLabel={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
            accessibilityRole="button"
            onPress={() => setDrawerOpen((open) => !open)}
            style={({ pressed }) => [
              styles.menuButton,
              { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.menuGlyph, { color: colors.text }]}>
              {drawerOpen ? "×" : "☰"}
            </Text>
          </Pressable>

          <View style={styles.headerBrand}>
            <Image
              accessibilityLabel="Virtual Rudra logo"
              alt="Virtual Rudra logo"
              resizeMode="contain"
              source={virtualRudraLogo}
              style={styles.brandLogo}
            />
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={[styles.brand, { color: colors.text }]}>
                Virtual Rudra
              </Text>
              <Text numberOfLines={1} style={[styles.pageTitle, { color: colors.muted }]}>
                {pageTitle}
              </Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              accessibilityHint="Changes the theme across admin screens"
              accessibilityLabel={`Switch to ${adminTheme === "dark" ? "light" : "dark"} mode`}
              accessibilityRole="button"
              onPress={toggleAdminTheme}
              style={({ pressed }) => [
                styles.themeButton,
                { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.themeGlyph, { color: colors.text }]}>
                {adminTheme === "dark" ? "☼" : "☾"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={openScanner}
              style={({ pressed }) => [
                styles.scanButton,
                { backgroundColor: colors.accent },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.scanGlyph}>▦</Text>
              <Text style={styles.scanButtonText}>Scan</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.content}>
        {WEBVIEW_SETUP_ERROR ? (
          <View style={[styles.loading, { backgroundColor: colors.background }]}>
            <Text style={[styles.message, { color: colors.muted }]}>
              {WEBVIEW_SETUP_ERROR}
            </Text>
          </View>
        ) : (
        <WebView<object>
          key={webViewKey}
          ref={webView}
          source={{ uri: url }}
          originWhitelist={WEBVIEW_ORIGIN_WHITELIST}
          onShouldStartLoadWithRequest={(request) => {
            try {
              return WEBVIEW_ORIGINS.has(new URL(request.url).origin);
            } catch {
              return false;
            }
          }}
          onNavigationStateChange={(navigationState) => {
            setCanGoBack(navigationState.canGoBack);
            setCurrentPath(getPath(navigationState.url));
            const sameOriginUrl = getSameOriginUrl(navigationState.url);
            if (sameOriginUrl) retryUrl.current = sameOriginUrl;
          }}
          onMessage={handleWebViewMessage}
          injectedJavaScriptBeforeContentLoaded={getStoredAdminThemeScript()}
          onLoadStart={(event) => {
            const sameOriginUrl = getSameOriginUrl(event.nativeEvent.url);
            if (sameOriginUrl) retryUrl.current = sameOriginUrl;
            loadFailed.current = false;
            isLoading.current = true;
            webViewLoaded.current = false;
            setLoadError("");
            startLoadTimeout();
          }}
          onLoad={() => {
            clearLoadTimeout();
            loadFailed.current = false;
            isLoading.current = false;
            webViewLoaded.current = true;
            setLoadError("");
          }}
          onLoadEnd={() => {
            clearLoadTimeout();
            if (!loadFailed.current) {
              isLoading.current = false;
              webViewLoaded.current = true;
            }
            if (webViewLoaded.current) {
              webView.current?.injectJavaScript(getWebViewAppearanceScript());
            }
          }}
          onError={(event) => {
            clearLoadTimeout();
            loadFailed.current = true;
            isLoading.current = false;
            webViewLoaded.current = false;
            setLoadError(getConnectionErrorMessage(event.nativeEvent.description));
          }}
          onHttpError={(event) => {
            let failedPath: string;
            try {
              failedPath = new URL(event.nativeEvent.url).pathname;
            } catch {
              return;
            }
            if (failedPath !== currentPath) return;
            loadFailed.current = true;
            clearLoadTimeout();
            isLoading.current = false;
            webViewLoaded.current = false;
            setLoadError(
              `The website returned an error (${event.nativeEvent.statusCode}).`,
            );
          }}
          onRenderProcessGone={() => {
            clearLoadTimeout();
            loadFailed.current = true;
            isLoading.current = false;
            webViewLoaded.current = false;
            setLoadError("The website view was interrupted. Retry to reopen this page.");
          }}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          incognito={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={[styles.message, { color: colors.muted }]}>
                Loading Virtual Rudra…
              </Text>
            </View>
          )}
          style={[styles.webView, { backgroundColor: colors.background }]}
        />
        )}
        {loadError ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <Text style={[styles.errorText, { color: colors.danger }]}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={retryWebView}
              style={[styles.retryButton, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        pointerEvents={drawerOpen ? "auto" : "none"}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.drawerScrim,
            {
              backgroundColor: colors.scrim,
              opacity: drawerProgress,
            },
          ]}
        />
        <Pressable
          accessibilityLabel="Close navigation menu"
          accessibilityRole="button"
          onPress={() => setDrawerOpen(false)}
          style={styles.drawerScrimHitArea}
        />
        <Animated.View
          accessibilityViewIsModal={drawerOpen}
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: colors.shadow,
              transform: [
                {
                  translateX: drawerProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-drawerWidth, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.drawerBrand,
              { borderBottomColor: colors.border },
            ]}
          >
            <View style={styles.drawerBrandTop}>
              <Image
                accessibilityLabel="Virtual Rudra logo"
                alt="Virtual Rudra logo"
                resizeMode="contain"
                source={virtualRudraLogo}
                style={styles.drawerLogo}
              />
              <Pressable
                accessibilityLabel="Close navigation menu"
                accessibilityRole="button"
                onPress={() => setDrawerOpen(false)}
                style={[
                  styles.drawerClose,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.drawerCloseText, { color: colors.text }]}>×</Text>
              </Pressable>
            </View>
            <Text style={[styles.drawerTitle, { color: colors.text }]}>Virtual Rudra</Text>
            <Text style={[styles.drawerSubtitle, { color: colors.muted }]}>
              Restaurant workspace
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.drawerScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>WORKSPACE</Text>
            <View style={styles.drawerLinks}>
              {navigation.map((item) => {
                const isActive = item.path.split("#")[0] === currentPath;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    key={item.label}
                    onPress={() => navigateTo(item.path)}
                    style={({ pressed }) => [
                      styles.drawerLink,
                      isActive && {
                        backgroundColor: colors.activeSurface,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.linkIcon,
                        {
                          backgroundColor: isActive
                            ? colors.activeIcon
                            : colors.surfaceSubtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.linkIconText,
                          { color: isActive ? colors.accent : colors.muted },
                        ]}
                      >
                        {item.icon}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.drawerLinkText,
                        { color: isActive ? colors.accent : colors.text },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {isActive ? (
                      <View style={[styles.activeIndicator, { backgroundColor: colors.accent }]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              style={({ pressed }) => [
                styles.drawerLink,
                styles.signOutLink,
                { borderTopColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.linkIcon, { backgroundColor: colors.surfaceSubtle }]}>
                <Text style={[styles.linkIconText, { color: colors.danger }]}>↪</Text>
              </View>
              <Text style={[styles.drawerLinkText, { color: colors.danger }]}>
                Sign out
              </Text>
            </Pressable>
            <View style={[styles.drawerFooter, { borderTopColor: colors.border }]}>
              <Text style={[styles.drawerFooterText, { color: colors.muted }]}>
                Secure restaurant workspace
              </Text>
            </View>
          </ScrollView>
        </Animated.View>
      </View>

      {scanning ? (
        <View style={[styles.scanner, { backgroundColor: "#13201c" }]}>
          <View style={styles.scannerHeader}>
            <View style={styles.scannerHeading}>
              <Text style={styles.scannerTitle}>Scan a QR code</Text>
              <Text style={styles.scannerHint}>
                Scan a customer table or admin login QR code.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setScanning(false)}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          {permission?.granted ? (
            <View style={styles.cameraFrame}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => handleScan(data)}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={styles.cameraGuide} />
            </View>
          ) : (
            <View style={styles.permissionCard}>
              <Text style={styles.message}>Camera access is needed to scan QR codes.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void requestPermission()}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Allow camera</Text>
              </Pressable>
            </View>
          )}
          {scanError ? (
            <Text accessibilityRole="alert" style={styles.scanError}>
              {scanError}
            </Text>
          ) : null}
          {scanError ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                scanned.current = false;
                setScanError("");
              }}
              style={[styles.retryButton, styles.scanAgainButton]}
            >
              <Text style={styles.retryText}>Scan again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 68,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 14,
  },
  menuGlyph: { fontSize: 21, lineHeight: 25, fontWeight: "600" },
  headerBrand: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  brandLogo: { width: 44, height: 32, flexShrink: 0 },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  brand: { fontSize: 14, fontWeight: "700", letterSpacing: -0.25 },
  pageTitle: { fontSize: 11, fontWeight: "500" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  themeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 13,
  },
  themeGlyph: { fontSize: 20, fontWeight: "700" },
  scanButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 13,
  },
  scanGlyph: { color: "#fffefb", fontSize: 17, fontWeight: "700" },
  scanButtonText: { color: "#fffefb", fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.74 },
  content: { flex: 1 },
  webView: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  message: { color: "#6e7671", fontSize: 15, textAlign: "center" },
  errorCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    padding: 16,
    borderWidth: 1,
    borderRadius: 18,
    alignItems: "center",
    gap: 12,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  errorText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryButton: {
    minHeight: 42,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#174b39",
  },
  retryText: { color: "#fffefb", fontSize: 14, fontWeight: "700" },
  drawerScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  drawerScrimHitArea: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 10 : 14,
    paddingHorizontal: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 16,
  },
  drawerBrand: { paddingBottom: 19, borderBottomWidth: StyleSheet.hairlineWidth },
  drawerBrandTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  drawerLogo: { width: 72, height: 48 },
  drawerClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 13,
  },
  drawerCloseText: { fontSize: 26, lineHeight: 29, fontWeight: "400" },
  drawerTitle: { marginTop: 16, fontSize: 19, fontWeight: "700", letterSpacing: -0.4 },
  drawerSubtitle: { marginTop: 4, fontSize: 12 },
  drawerScrollContent: { flexGrow: 1, paddingBottom: 4 },
  sectionLabel: {
    marginTop: 23,
    marginBottom: 10,
    paddingHorizontal: 9,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  drawerLinks: { gap: 5 },
  drawerLink: {
    minHeight: 49,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 13,
  },
  linkIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  linkIconText: { fontSize: 17, fontWeight: "700" },
  drawerLinkText: { flex: 1, fontSize: 14, fontWeight: "600" },
  activeIndicator: { width: 6, height: 6, borderRadius: 3 },
  signOutLink: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 13 },
  drawerFooter: {
    marginTop: "auto",
    paddingVertical: 17,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#deddd6",
  },
  drawerFooterText: { fontSize: 11 },
  scanner: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    padding: 20,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 20 : 20,
  },
  scannerHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
  },
  scannerHeading: { flex: 1, gap: 4 },
  scannerTitle: { color: "#fffefb", fontSize: 20, fontWeight: "700" },
  scannerHint: { color: "#deddd6", fontSize: 13 },
  closeButton: { padding: 10 },
  closeText: { color: "#fffefb", fontSize: 15, fontWeight: "600" },
  cameraFrame: { width: "100%", aspectRatio: 1, overflow: "hidden", borderRadius: 24 },
  cameraGuide: {
    position: "absolute",
    left: "16%",
    top: "16%",
    width: "68%",
    height: "68%",
    borderWidth: 3,
    borderColor: "#f0b18a",
    borderRadius: 24,
  },
  permissionCard: { alignItems: "center", gap: 16, padding: 24 },
  scanError: { marginTop: 16, color: "#f0b18a", fontSize: 14, textAlign: "center" },
  scanAgainButton: { alignSelf: "center", marginTop: 12 },
});
