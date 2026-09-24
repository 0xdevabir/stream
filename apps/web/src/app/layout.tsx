import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { ConfirmProvider } from "@/components/dialog";
import { SessionProvider } from "@/lib/session";

import "./globals.css";

// San Francisco is used wherever the OS ships it; Inter is the closest match
// for everyone else.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Live Classes",
    template: "%s · Live Classes",
  },
  description:
    "Low-latency, encrypted live classes with automatic recording and replay.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8080",
  ),
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Classes" },
};

export const viewport: Viewport = {
  themeColor: "#151515",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Students watch on phones; letting them pinch-zoom the chat is worth more
  // than a perfectly locked layout.
  maximumScale: 5,
  // Lets the tab bar sit under the home indicator, padded by safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh">
        <SessionProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
