import type { Metadata } from "next";
// @ts-expect-error -- Next.js supports global CSS side-effect imports in app/layout.tsx
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Echios — STP Trading Platform",
  description: "Straight-Through Processing trade lifecycle platform (Hackathon MVP)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#101317] text-[#EFF0F2] antialiased selection:bg-[#4FA9E8]/30 selection:text-[#4FA9E8]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
