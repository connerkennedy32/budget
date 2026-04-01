import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Cormorant_Garamond, JetBrains_Mono, Figtree } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabNav } from "@/components/TabNav";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Budget",
  description: "Personal finance tools",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Budget",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorantGaramond.variable} ${jetbrainsMono.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <ThemeProvider>
          <ServiceWorkerRegistration />
          <TabNav />
          <div data-scroll-container className="flex-1 min-h-0">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
