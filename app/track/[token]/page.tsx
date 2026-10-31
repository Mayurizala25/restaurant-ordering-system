import type { Metadata } from "next";
import OrderTrackingClient from "./tracking-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Track your order | Virtual Rudra",
  description: "View the latest status of your Virtual Rudra order.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OrderTrackingClient token={token} />;
}
