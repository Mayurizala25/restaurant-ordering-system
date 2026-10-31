import type { Metadata } from "next";
import MenuClient from "./menu-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Menu | Virtual Rudra",
  description: "Explore the Virtual Rudra menu.",
};

export default function MenuPage() {
  return <MenuClient />;
}
