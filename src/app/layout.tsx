import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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
  title: { default: "StartupsHQ", template: "%s · StartupsHQ" },
  description:
    "Startups, founders, investors and accelerator batches — connected.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by the inline script, so React must not call it a mismatch.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs while the page parses, before first paint. The public CSP allows inline scripts
            (ADR-022); the admin origin's nonce policy blocks this one until the admin layout
            passes its nonce (Phase 18). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from src/lib/theme.ts, no input.
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
