import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Mono, Bungee } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ThemeInit } from "@/components/ThemeInit";
import { THEME_COLORS, themeInitScript } from "@/lib/theme";

// Runs before first paint so the chosen theme never flashes the wrong one on load: lib/theme.ts reads the stored choice
// straight from localStorage (not through the store, which hasn't hydrated yet this early). Dark when nothing is stored.
const THEME_INIT_SCRIPT = themeInitScript();

// DM Sans for text; Space Mono for the numerals that should line up (time, BPM).
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const retroDisplay = Bungee({
  variable: "--font-retro",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI DJ",
  description: "An AI DJ that mixes your music into one continuous set.",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AI DJ",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The browser's own chrome (Android address bar, iOS Safari's tinted status area) follows the app's own theme choice,
  // not the phone's: lib/theme.ts re-tints this tag when the theme changes (and the script above does on load). Dark is
  // the default, so that is what the server renders.
  themeColor: THEME_COLORS.dark,
  // Lets the layout extend under a notch/home-indicator; the player bar and
  // overlay panels pad themselves with env(safe-area-inset-*) so nothing
  // important ends up underneath it.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${spaceMono.variable} ${retroDisplay.variable} h-full antialiased`}
      data-theme="dark"
      // The inline theme script below intentionally sets data-theme on this
      // element before React hydrates (to avoid a flash of the wrong
      // theme) — that deliberate mismatch is exactly what
      // suppressHydrationWarning exists for; it only suppresses the
      // warning for this element's own attributes, not recursively.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* h-dvh (dynamic viewport height), not h-full/100vh: on phones the
          browser's collapsing address bar makes 100vh taller than what's
          actually visible, which pushed the player bar below the fold. */}
      <body className="h-dvh flex flex-col overflow-hidden">
        <ServiceWorkerRegister />
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
