export const SITE_URL = "https://virtual-rudra.vercel.app/";
export const SITE_ORIGIN = new URL(SITE_URL).origin;

const TABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getQrDestination(
  data: string,
  developmentOrigin?: string,
): string | null {
  try {
    const qrUrl = new URL(data);
    const configuredSiteUrl = process.env.EXPO_PUBLIC_WEBVIEW_URL;
    const configuredSite = configuredSiteUrl
      ? new URL(configuredSiteUrl)
      : null;
    const isConfiguredOrigin =
      configuredSite !== null && qrUrl.origin === configuredSite.origin;
    const isSiteOrigin = qrUrl.origin === SITE_ORIGIN;
    const isDevelopmentOrigin =
      developmentOrigin !== undefined &&
      qrUrl.origin === developmentOrigin &&
      qrUrl.protocol === "http:";
    if (
      (!isSiteOrigin && !isDevelopmentOrigin && !isConfiguredOrigin) ||
      qrUrl.username ||
      qrUrl.password ||
      configuredSite?.username ||
      configuredSite?.password ||
      (configuredSite !== null &&
        configuredSite.protocol !== "https:" &&
        configuredSite.protocol !== "http:")
    ) {
      return null;
    }

    const destinationOrigin = isDevelopmentOrigin
      ? developmentOrigin
      : isConfiguredOrigin
        ? configuredSite.origin
        : SITE_URL;
    if (/^\/admin\/login\/?$/.test(qrUrl.pathname)) {
      return new URL("/admin/login", destinationOrigin).toString();
    }

    if (qrUrl.pathname !== "/menu") return null;
    const tableId = qrUrl.searchParams.get("tableId");
    const rawTableNumber = qrUrl.searchParams.get("tableNumber");
    if (!tableId || !TABLE_ID_PATTERN.test(tableId) || !rawTableNumber || !/^\d+$/.test(rawTableNumber)) {
      return null;
    }

    const tableNumber = Number(rawTableNumber);
    if (!Number.isSafeInteger(tableNumber) || tableNumber < 1) return null;

    const menuUrl = new URL("/menu", destinationOrigin);
    menuUrl.searchParams.set("tableId", tableId);
    menuUrl.searchParams.set("tableNumber", String(tableNumber));
    return menuUrl.toString();
  } catch {
    return null;
  }
}
