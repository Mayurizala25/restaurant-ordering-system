import type { Metadata } from "next";
import InvoiceClient from "./invoice-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Order Invoice | Virtual Rudra",
  description: "View and print your Virtual Rudra order invoice.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ download?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  return (
    <InvoiceClient
      autoPrint={query.download === "1"}
      token={token}
    />
  );
}
