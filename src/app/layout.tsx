import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { PostHogInit } from "@/components/analytics";

// Body: clean, highly legible. Display/headings: Space Grotesk (technical
// character). Instrument readouts (scores, weights): IBM Plex Mono, tabular,
// reads like a measuring-instrument display.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const DESCRIPTION =
  "Log your training and get a daily readiness score, deload alerts, StrengthLevel-style standards, and an AI coach that reasons from your real numbers.";

export const metadata: Metadata = {
  metadataBase: new URL("https://mydeloadtracker.vercel.app"),
  applicationName: "MyDeloadTracker",
  title: "MyDeloadTracker, the AI strength coach that knows when to deload",
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "MyDeloadTracker, the AI strength coach that knows when to deload",
    description: DESCRIPTION,
    url: "/",
    siteName: "MyDeloadTracker",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MyDeloadTracker, the AI strength coach that knows when to deload",
    description: DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Deload",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${plexMono.variable} font-sans`}>
        {children}
        <PwaRegister />
        <PostHogInit />
      </body>
    </html>
  );
}
