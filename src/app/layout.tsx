import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StartupsHQ",
  description:
    "Startups, founders, investors and accelerator batches — connected.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by /theme.js, so React must not treat it as a mismatch.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Parser-blocking on purpose: the saved theme must apply before first paint. It is a
            same-origin file because the public CSP forbids inline scripts (SEC-09). The admin
            origin's nonce policy blocks it; the admin layout applies the theme itself (Phase 18). */}
        <script src="/theme.js" />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
