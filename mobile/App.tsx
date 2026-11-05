import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";

function getWebsiteUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  if (configuredUrl) return configuredUrl;

  return "https://virtual-rudra.vercel.app";
}

const websiteUrl = getWebsiteUrl();
const TABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEBVIEW_LOAD_TIMEOUT_MS = 30_000;

function logWebViewEvent(
  event: string,
  details: Record<string, string | number | boolean> = {},
) {
  console.info("[virtual-rudra:webview]", {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  });
}

function getSanitizedSameOriginUrl(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);
    if (
      !["http:", "https:"].includes(parsedUrl.protocol) ||
      parsedUrl.origin !== new URL(websiteUrl).origin
    ) {
      return undefined;
    }

    return `${parsedUrl.origin}/`;
  } catch {
    return undefined;
  }
}

function getTableMenuUrl(data: string): string | null {
  try {
    const scannedUrl = new URL(data);
    if (
      !["http:", "https:"].includes(scannedUrl.protocol) ||
      scannedUrl.pathname !== "/menu"
    ) {
      return null;
    }

    const tableId = scannedUrl.searchParams.get("tableId");
    const tableNumberValue = scannedUrl.searchParams.get("tableNumber");
    if (
      !tableId ||
      !TABLE_ID_PATTERN.test(tableId) ||
      !tableNumberValue ||
      !/^\d+$/.test(tableNumberValue)
    ) {
      return null;
    }

    const tableNumber = Number(tableNumberValue);
    if (
      !Number.isSafeInteger(tableNumber) ||
      tableNumber < 1 ||
      tableNumber > 2_147_483_647
    ) {
      return null;
    }

    const menuUrl = new URL(websiteUrl);
    menuUrl.pathname = "/menu";
    menuUrl.search = "";
    menuUrl.searchParams.set("tableId", tableId);
    menuUrl.searchParams.set("tableNumber", String(tableNumber));
    return menuUrl.toString();
  } catch {
    return null;
  }
}

export default function App() {
  const adminLoginUrl = new URL("/admin/login", websiteUrl).toString();
  const webView = useRef<WebView<object> | null>(null);
  const canGoBack = useRef(false);
  const hasScanned = useRef(false);
  const webViewLoaded = useRef(false);
  const retryUrl = useRef(adminLoginUrl);
  const pendingTableMenuUrl = useRef<string | null>(null);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoading = useRef(false);
  const loadStartedAt = useRef<number | null>(null);
  const loadDurationDetails = (): Record<
    string,
    string | number | boolean
  > =>
    loadStartedAt.current === null
      ? {}
      : { durationMs: Date.now() - loadStartedAt.current };
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [barcodeHandled, setBarcodeHandled] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [scanError, setScanError] = useState("");
  const [webViewRequest, setWebViewRequest] = useState({
    key: 0,
    url: adminLoginUrl,
  });

  useEffect(
    () => () => {
      if (loadTimeout.current) clearTimeout(loadTimeout.current);
    },
    [],
  );

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = null;
  }, []);

  const startLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    loadStartedAt.current = Date.now();
    loadTimeout.current = setTimeout(() => {
      loadTimeout.current = null;
      isLoading.current = false;
      webViewLoaded.current = false;
      webView.current?.stopLoading();
      const url = getSanitizedSameOriginUrl(retryUrl.current);
      logWebViewEvent("timeout", {
        ...loadDurationDetails(),
        ...(url ? { url } : {}),
      });
      loadStartedAt.current = null;
      setLoadError(
        "The restaurant website is taking too long to respond. Check your connection and try again.",
      );
    }, WEBVIEW_LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        clearLoadTimeout();
        return;
      }
      if (isLoading.current && !webViewLoaded.current) {
        const url = getSanitizedSameOriginUrl(retryUrl.current);
        logWebViewEvent("foreground-resume", {
          ...loadDurationDetails(),
          ...(url ? { url } : {}),
        });
        startLoadTimeout();
      }
    });

    return () => {
      subscription.remove();
      clearLoadTimeout();
    };
  }, [clearLoadTimeout, startLoadTimeout]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const currentUrl = new URL(window.location.href);
    const targetUrl = new URL(adminLoginUrl);
    if (
      currentUrl.origin !== targetUrl.origin ||
      currentUrl.pathname !== targetUrl.pathname
    ) {
      window.location.replace(targetUrl.toString());
    }
  }, [adminLoginUrl]);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (isScanning) {
          setIsScanning(false);
          return true;
        }
        if (!canGoBack.current) return false;
        webView.current?.goBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [isScanning]);

  function handleNavigationChange(state: WebViewNavigation) {
    canGoBack.current = state.canGoBack;
    rememberRetryUrl(state.url);
  }

  function handleWebViewMessage(data: string) {
    try {
      const message: unknown = JSON.parse(data);
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "route" &&
        "url" in message &&
        typeof message.url === "string"
      ) {
        rememberRetryUrl(message.url);
      }
    } catch {
      // Ignore unrelated page messages.
    }
  }

  function rememberRetryUrl(url: string) {
    try {
      const parsedUrl = new URL(url);
      if (
        (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
        parsedUrl.origin === new URL(websiteUrl).origin
      ) {
        retryUrl.current = url;
      }
    } catch {
      // Ignore non-URL navigation events and keep the last valid destination.
    }
  }

  function retryWebView() {
    clearLoadTimeout();
    webViewLoaded.current = false;
    canGoBack.current = false;
    isLoading.current = true;
    logWebViewEvent("retry");
    setLoadError("");
    setWebViewRequest((request) => ({
      key: request.key + 1,
      url: retryUrl.current || adminLoginUrl,
    }));
  }

  function openPendingTableMenu() {
    const menuUrl = pendingTableMenuUrl.current;
    const currentWebView = webView.current;
    if (!menuUrl || !webViewLoaded.current || !currentWebView) return;

    try {
      currentWebView.injectJavaScript(
        `window.location.assign(${JSON.stringify(menuUrl)}); true;`,
      );
      pendingTableMenuUrl.current = null;
      setScanError("");
    } catch {
      setLoadError("The scanned table menu could not be opened. Try again.");
    }
  }

  async function handleCameraPermission() {
    try {
      const result = await requestPermission();
      if (!result.granted) {
        setScanError("Camera access is required to scan a table QR code.");
      } else {
        setScanError("");
      }
    } catch (cause) {
      setScanError(
        cause instanceof Error
          ? cause.message
          : "Camera permission could not be requested.",
      );
    }
  }

  function handleBarcodeScanned(data: string) {
    if (hasScanned.current) return;
    hasScanned.current = true;
    setBarcodeHandled(true);

    const menuUrl = getTableMenuUrl(data);
    if (!menuUrl) {
      setScanError("This is not a valid Virtual Rudra table menu QR code.");
      return;
    }

    pendingTableMenuUrl.current = menuUrl;
    setScanError("");
    setIsScanning(false);
    openPendingTableMenu();
  }

  function openScanner() {
    hasScanned.current = false;
    setBarcodeHandled(false);
    setScanError("");
    setIsScanning(true);
  }

  if (Platform.OS === "web") {
    return (
      <View style={styles.webHandoff}>
        <View style={styles.feedbackCard}>
          <Text style={styles.webHandoffTitle}>Opening Virtual Rudra</Text>
          <Text style={styles.webHandoffText}>
            Taking you to the admin sign-in page.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => window.location.assign(adminLoginUrl)}
            style={({ pressed }) => [
              styles.scanButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.scanButtonText}>Continue to sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={Platform.OS === "android" ? [] : undefined}
      style={styles.safeArea}
    >
      <StatusBar
        barStyle={isScanning ? "light-content" : "dark-content"}
      />
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>V</Text>
            </View>
            <Text style={styles.brand}>Virtual Rudra</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={openScanner}
            style={({ pressed }) => [
              styles.scanButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.scanButtonText}>Scan table QR</Text>
          </Pressable>
        </View>

        <WebView<object>
          key={webViewRequest.key}
          ref={webView}
          source={{ uri: webViewRequest.url }}
          style={styles.webView}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          setSupportMultipleWindows={false}
          onNavigationStateChange={handleNavigationChange}
          onMessage={(event) => handleWebViewMessage(event.nativeEvent.data)}
          injectedJavaScript={`
            (function () {
              if (window.__virtualRudraRouteTracking) return true;
              window.__virtualRudraRouteTracking = true;
              var reportRoute = function () {
                if (
                  window.ReactNativeWebView &&
                  window.location.origin === ${JSON.stringify(new URL(websiteUrl).origin)}
                ) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: "route",
                    url: window.location.href
                  }));
                }
              };
              ["pushState", "replaceState"].forEach(function (method) {
                var original = window.history[method];
                window.history[method] = function () {
                  var result = original.apply(this, arguments);
                  reportRoute();
                  return result;
                };
              });
              window.addEventListener("popstate", reportRoute);
              window.addEventListener("hashchange", reportRoute);
              reportRoute();
            })();
            true;
          `}
          onLoadStart={(event) => {
            rememberRetryUrl(event.nativeEvent.url);
            webViewLoaded.current = false;
            isLoading.current = true;
            setLoadError("");
            startLoadTimeout();
            const url = getSanitizedSameOriginUrl(event.nativeEvent.url);
            logWebViewEvent("load-start", {
              ...(url ? { url } : {}),
            });
          }}
          onLoad={(event) => {
            clearLoadTimeout();
            isLoading.current = false;
            setLoadError("");
            webViewLoaded.current = true;
            const url = getSanitizedSameOriginUrl(event.nativeEvent.url);
            logWebViewEvent("load-success", {
              ...loadDurationDetails(),
              ...(url ? { url } : {}),
            });
            openPendingTableMenu();
          }}
          onLoadEnd={(event) => {
            const url = getSanitizedSameOriginUrl(event.nativeEvent.url);
            logWebViewEvent("load-end", {
              ...loadDurationDetails(),
              ...(url ? { url } : {}),
            });
            clearLoadTimeout();
            isLoading.current = false;
            loadStartedAt.current = null;
          }}
          onError={(event) => {
            rememberRetryUrl(event.nativeEvent.url);
            webViewLoaded.current = false;
            isLoading.current = false;
            clearLoadTimeout();
            webView.current?.stopLoading();
            const url = getSanitizedSameOriginUrl(event.nativeEvent.url);
            logWebViewEvent("network-error", {
              code: event.nativeEvent.code,
              ...loadDurationDetails(),
              ...(url ? { url } : {}),
            });
            loadStartedAt.current = null;
            setLoadError(
              event.nativeEvent.description ||
                "The restaurant website could not be loaded.",
            );
          }}
          onHttpError={(event) => {
            rememberRetryUrl(event.nativeEvent.url);
            isLoading.current = false;
            clearLoadTimeout();
            webViewLoaded.current = false;
            webView.current?.stopLoading();
            const url = getSanitizedSameOriginUrl(event.nativeEvent.url);
            logWebViewEvent("http-error", {
              statusCode: event.nativeEvent.statusCode,
              ...loadDurationDetails(),
              ...(url ? { url } : {}),
            });
            loadStartedAt.current = null;
            setLoadError(
              `The restaurant website returned HTTP ${event.nativeEvent.statusCode}. Check your connection and try again.`,
            );
          }}
          onRenderProcessGone={(event) => {
            clearLoadTimeout();
            isLoading.current = false;
            webViewLoaded.current = false;
            canGoBack.current = false;
            const url = getSanitizedSameOriginUrl(retryUrl.current);
            logWebViewEvent("renderer-terminated", {
              didCrash: event.nativeEvent.didCrash,
              ...loadDurationDetails(),
              ...(url ? { url } : {}),
            });
            loadStartedAt.current = null;
            setLoadError(
              "The website view was interrupted. Retry to reopen this page.",
            );
          }}
        />

        {loadError ? (
          <View style={styles.loadError}>
            <View style={styles.feedbackCard}>
              <Text style={styles.errorTitle}>Could not load Virtual Rudra</Text>
              <Text style={styles.errorText}>{loadError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={retryWebView}
                style={({ pressed }) => [
                  styles.scanButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.scanButtonText}>Try again</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {isScanning && (
          <View style={styles.scanner}>
            <View style={styles.scannerHeader}>
              <View>
                <Text style={styles.scannerTitle}>Scan table QR</Text>
                <Text style={styles.scannerHint}>
                  Point your camera at a Virtual Rudra table code.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close QR scanner"
                accessibilityRole="button"
                onPress={() => setIsScanning(false)}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.closeButtonPressed,
                ]}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>

            {permission?.granted ? (
              <View style={styles.cameraFrame}>
                <CameraView
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={
                    barcodeHandled
                      ? undefined
                      : ({ data }) => handleBarcodeScanned(data)
                  }
                  style={styles.camera}
                />
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.cameraGuide}
                />
              </View>
            ) : (
              <View style={styles.permission}>
                <View style={styles.permissionCard}>
                  <Text style={styles.permissionTitle}>Camera access needed</Text>
                  <Text style={styles.permissionHint}>
                    Allow camera access to scan a table QR code.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleCameraPermission()}
                    style={({ pressed }) => [
                      styles.scanButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.scanButtonText}>Allow camera</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {scanError ? (
              <View style={styles.scanError}>
                <Text style={styles.scanErrorText}>{scanError}</Text>
                {permission?.granted && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      hasScanned.current = false;
                      setBarcodeHandled(false);
                      setScanError("");
                    }}
                    style={({ pressed }) => [
                      styles.tryAgainButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.scanButtonText}>Scan again</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f3ed",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0,
  },
  container: {
    flex: 1,
    backgroundColor: "#f5f3ed",
  },
  webHandoff: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    backgroundColor: "#f5f3ed",
  },
  feedbackCard: {
    width: "100%",
    maxWidth: 440,
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "#deddd6",
    borderRadius: 22,
    backgroundColor: "#fffefb",
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: "#16201d",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  brandLockup: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  brandMark: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#13201c",
  },
  brandMarkText: {
    color: "#f0b18a",
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -1,
  },
  webHandoffTitle: {
    color: "#16201d",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  webHandoffText: {
    color: "#6e7671",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  header: {
    minHeight: 68,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#deddd6",
    backgroundColor: "#fffefb",
    shadowColor: "#16201d",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.045,
    shadowRadius: 12,
    elevation: 2,
  },
  brand: {
    flexShrink: 1,
    color: "#13201c",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  scanButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#a95b2e",
    borderRadius: 12,
    backgroundColor: "#c26d3a",
    paddingHorizontal: 15,
    shadowColor: "#a95b2e",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 2,
  },
  buttonPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.9,
  },
  scanButtonText: {
    color: "#fffefb",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  webView: {
    flex: 1,
    backgroundColor: "#f5f3ed",
  },
  loadError: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    backgroundColor: "rgba(245, 243, 237, 0.96)",
  },
  errorTitle: {
    color: "#16201d",
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.35,
    textAlign: "center",
  },
  errorText: {
    color: "#a44a3f",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  scanner: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    backgroundColor: "#13201c",
    paddingBottom: Platform.OS === "android" ? 12 : 0,
  },
  scannerHeader: {
    minHeight: 88,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 254, 251, 0.16)",
  },
  scannerTitle: {
    color: "#fffefb",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  scannerHint: {
    marginTop: 5,
    color: "#c0c9c1",
    fontSize: 12,
    lineHeight: 18,
  },
  closeButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 254, 251, 0.24)",
    borderRadius: 11,
    backgroundColor: "rgba(255, 254, 251, 0.06)",
    paddingHorizontal: 13,
  },
  closeButtonPressed: {
    backgroundColor: "rgba(255, 254, 251, 0.14)",
  },
  closeButtonText: {
    color: "#fffefb",
    fontSize: 13,
    fontWeight: "600",
  },
  cameraFrame: {
    flex: 1,
    margin: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#435d4e",
    borderRadius: 22,
    backgroundColor: "#111714",
  },
  camera: {
    ...StyleSheet.absoluteFill,
  },
  cameraGuide: {
    position: "absolute",
    top: "16%",
    bottom: "16%",
    left: "9%",
    right: "9%",
    alignSelf: "center",
    borderWidth: 2,
    borderColor: "#f0b18a",
    borderRadius: 20,
  },
  permission: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  permissionCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 13,
    borderWidth: 1,
    borderColor: "#deddd6",
    borderRadius: 20,
    backgroundColor: "#fffefb",
    padding: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 4,
  },
  permissionTitle: {
    color: "#16201d",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  permissionHint: {
    color: "#6e7671",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  scanError: {
    alignItems: "center",
    gap: 10,
    marginHorizontal: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e5c7bf",
    borderRadius: 14,
    backgroundColor: "#fff7f1",
    padding: 14,
  },
  scanErrorText: {
    color: "#a44a3f",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  tryAgainButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#a95b2e",
    borderRadius: 12,
    backgroundColor: "#c26d3a",
    paddingHorizontal: 15,
  },
});
