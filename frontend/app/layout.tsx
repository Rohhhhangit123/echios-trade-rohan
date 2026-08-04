import type { Metadata } from "next";
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
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
