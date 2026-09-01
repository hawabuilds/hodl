import type {Metadata, Viewport} from "next";
import {Inter_Tight, JetBrains_Mono} from "next/font/google";
import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {Providers} from "@/components/providers/Providers";
import {OVERLAY_ROOT_ID} from "@/components/ui/OverlayPortal";
import "./globals.css";

/**
 * Inter Tight for everything the eye reads as interface.
 *
 * Its default tracking is already close to what a dense ticker list wants, so
 * headlines and 11px labels both sit right without per-element correction, and
 * its tabular figures keep a column of prices from shifting as digits change.
 */
const display = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

/**
 * A mono for the things that are literally hashes: contract addresses, wallets,
 * transaction ids. Not for prices — proportional figures with `tabular-nums`
 * read faster at a glance, and mono at 32px looks like a terminal.
 */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: APP_SUBTITLE,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Two entries so the phone's own chrome follows the theme; a single light
  // value left a white bar above a dark app.
  themeColor: [
    {media: "(prefers-color-scheme: light)", color: "#FFFFFF"},
    {media: "(prefers-color-scheme: dark)", color: "#0A0B0B"},
  ],
};

export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applied before first paint so a dark-mode reload never flashes white. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("rwa.theme");var d=t==="dark"||(t!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#0A0B0B");}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans text-ink antialiased">
        <Providers>
          <div className="app-frame">
            {children}
            <div id={OVERLAY_ROOT_ID} />
          </div>
        </Providers>
      </body>
    </html>
  );
}
