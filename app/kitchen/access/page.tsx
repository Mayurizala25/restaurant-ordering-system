import { redirect } from "next/navigation";

export const instant = false;

type KitchenAccessPageProps = {
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

const ORDER_DETAILS_PATH =
  /^\/kitchen\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSafeReturnTo(value: string | string[] | undefined): string {
  const destination = Array.isArray(value) ? value[0] : value;
  if (
    destination === "/kitchen" ||
    destination === "/kitchen/history" ||
    (destination !== undefined && ORDER_DETAILS_PATH.test(destination))
  ) {
    return destination;
  }
  return "/kitchen";
}

export default async function KitchenAccessPage({
  searchParams,
}: KitchenAccessPageProps) {
  const { returnTo } = await searchParams;
  redirect(
    `/admin/login?returnTo=${encodeURIComponent(getSafeReturnTo(returnTo))}`,
  );
}
