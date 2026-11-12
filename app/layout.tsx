import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthGate } from "@/components/auth/AuthGate";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "KIVOXEL Studio", template: "%s · KIVOXEL Studio" },
  description: "Productiestudio van het YouTube-kanaal Kivoxel",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
