import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/Nav";
import { UiProvider } from "@/components/ui";

export const metadata: Metadata = { title: "Content Factory", description: "Type it. Press the button. Get shorts." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1020" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Press+Start+2P&display=swap"
        />
      </head>
      <body>
        <UiProvider>
          <Nav />
          <main className="wrap">{children}</main>
        </UiProvider>
      </body>
    </html>
  );
}
