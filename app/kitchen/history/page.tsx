import type { Metadata } from "next";
import KitchenHistoryClient from "./history-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Kitchen Order History | Virtual Rudra",
  description: "Review completed and cancelled kitchen tickets.",
  robots: { index: false, follow: false },
};

export default function KitchenHistoryPage() {
  return <KitchenHistoryClient />;
}
