import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bungee } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ThemeInit } from "@/components/ThemeInit";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// Runs before first paint so dark mode never flashes light on load — reads
// the same zustand-persist localStorage key lib/theme.ts writes to,
// directly (not through the store, which hasn't hydrated yet this early).
const THEME_INIT_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var t=r?JSON.parse(r).state.theme:null;if(t==="dark")document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
  themeColor: "#9333ea",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${retroDisplay.variable} h-full antialiased`}
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
      <body className="h-full flex flex-col overflow-hidden">
        <ServiceWorkerRegister />
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
