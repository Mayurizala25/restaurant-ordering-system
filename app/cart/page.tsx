import type { Metadata } from "next";
import MenuClient from "../menu/menu-client";

export const metadata: Metadata = {
  title: "Your Cart | Virtual Rudra",
  description: "Review your Virtual Rudra order.",
};

export default function CartPage() {
  return <MenuClient page="cart" />;
}
