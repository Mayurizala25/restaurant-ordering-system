const ORDER_DETAILS_PATH =
  /^\/kitchen\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getKitchenAuthenticationPath(returnTo: string): string {
  const safeReturnTo =
    returnTo === "/kitchen" ||
    returnTo === "/kitchen/history" ||
    ORDER_DETAILS_PATH.test(returnTo)
      ? returnTo
      : "/kitchen";
  return `/admin/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
}
