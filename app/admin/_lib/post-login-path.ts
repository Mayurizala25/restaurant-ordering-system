const KITCHEN_ORDER_PATH =
  /^\/kitchen\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAdminPostLoginPath(returnTo: string | null): string {
  if (
    returnTo === "/kitchen" ||
    returnTo === "/kitchen/history" ||
    (returnTo !== null && KITCHEN_ORDER_PATH.test(returnTo))
  ) {
    return returnTo;
  }
  return "/admin/dashboard";
}
