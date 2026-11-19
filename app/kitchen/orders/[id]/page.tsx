import type { Metadata } from "next";
import KitchenOrderDetailClient from "./order-detail-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Kitchen Ticket Details | Virtual Rudra",
  description: "Kitchen order details and preparation status.",
  robots: { index: false, follow: false },
};

export default async function KitchenOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <KitchenOrderDetailClient orderId={id} />;
}
