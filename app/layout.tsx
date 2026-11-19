import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import PullToRefresh from "./pull-to-refresh";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Virtual Rudra | Made for memorable meals",
  description:
    "Made for memorable meals. A considered restaurant workspace by Virtual Rudra.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PullToRefresh>{children}</PullToRefresh>
      </body>
    </html>
  );
}
