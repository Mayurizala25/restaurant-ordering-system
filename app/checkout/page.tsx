import type { Metadata } from "next";
import MenuClient from "../menu/menu-client";

export const metadata: Metadata = {
  title: "Checkout | Virtual Rudra",
  description: "Complete your Virtual Rudra order.",
};

export default function CheckoutPage() {
  return <MenuClient page="checkout" />;
}
