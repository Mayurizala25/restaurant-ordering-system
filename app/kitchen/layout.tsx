import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./kitchen.css";

export const metadata: Metadata = {
  title: "Kitchen Dashboard | Virtual Rudra",
  description: "Live kitchen orders and preparation status.",
};

export default function KitchenLayout({ children }: { children: ReactNode }) {
  return <div className="kitchen-scope">{children}</div>;
}
