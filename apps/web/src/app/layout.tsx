import type { Metadata, Viewport } from "next";

import { SessionProvider } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Stream",
    template: "%s · Stream",
  },
  description:
    "Live + VOD streaming provider API — developer console for tenants.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8080",
  ),
};

export const viewport: Viewport = {
  themeColor: "#111318",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
