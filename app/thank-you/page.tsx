import type { Metadata } from "next";
import MenuClient from "../menu/menu-client";

export const metadata: Metadata = {
  title: "Order confirmed | Virtual Rudra",
  description: "Your Virtual Rudra order is confirmed.",
};

export default function ThankYouPage() {
  return <MenuClient page="thank-you" />;
}
