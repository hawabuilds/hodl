import type {Metadata, Viewport} from "next";
import {Inter, JetBrains_Mono} from "next/font/google";
import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {appOrigin} from "@/config/appUrl";
import {Providers} from "@/components/providers/Providers";
import {OVERLAY_ROOT_ID} from "@/components/ui/OverlayPortal";
import "./globals.css";

/**
 * Inter for interface copy: 400 body, 300 large display, 500/700 headings.
 * Tabular figures keep price columns stable; mono stays on hashes only.
 */
const display = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin()),
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: APP_SUBTITLE,
  openGraph: {
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_SUBTITLE,
    siteName: APP_NAME,
    type: "website",
    images: [{url: "/brand/og-logo.png", width: 1200, height: 630, alt: APP_NAME}],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      {url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png"},
      {url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png"},
      {url: "/brand/favicon-64.png", sizes: "64x64", type: "image/png"},
      {url: "/brand/favicon-128.png", sizes: "128x128", type: "image/png"},
    ],
    apple: [{url: "/brand/apple-icon.png", sizes: "180x180", type: "image/png"}],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    {media: "(prefers-color-scheme: light)", color: "#F5F5FF"},
    {media: "(prefers-color-scheme: dark)", color: "#0D0F18"},
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var root=document.documentElement;var pref=null;try{pref=localStorage.getItem("rwa.theme");}catch(e){}var sys=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";var theme=(pref==="light"||pref==="dark")?pref:(pref==="system"?sys:sys);root.classList.toggle("dark",theme==="dark");root.classList.toggle("light",theme==="light");root.style.colorScheme=theme;root.dataset.theme=theme;var q=new URLSearchParams(location.search).get("palette");var p=(q==="legacy"||q==="terminal")?q:null;if(!p){try{p=localStorage.getItem("rwa.palette");}catch(e){}}if(p==="legacy"&&theme==="dark"){root.setAttribute("data-palette","legacy");}else{root.removeAttribute("data-palette");}if(q==="legacy"||q==="terminal"){try{localStorage.setItem("rwa.palette",q);}catch(e){}}var tc=theme==="light"?"#F5F5FF":(p==="legacy"?"#161A40":"#0D0F18");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",tc);}catch(e){document.documentElement.classList.add("dark");}})();`,
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
