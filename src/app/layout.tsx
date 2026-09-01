import type {Metadata, Viewport} from "next";
import {Manrope} from "next/font/google";
import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {Providers} from "@/components/providers/Providers";
import {OVERLAY_ROOT_ID} from "@/components/ui/OverlayPortal";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
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
  themeColor: "#FFFFFF",
};

export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        {/* Applied before first paint so a dark-mode reload never flashes white. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("rwa.theme");if(t==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#0F1311");}}catch(e){}})();`,
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
