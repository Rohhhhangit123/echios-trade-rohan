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
      <body className="min-h-screen bg-[#0d0a12] text-slate-100 antialiased selection:bg-purple-500/30 selection:text-purple-200">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
