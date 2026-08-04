"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  LineChart,
  PlusCircle,
  Sparkles,
  CandlestickChart,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Activity },
  { href: "/exceptions", label: "Exceptions", icon: AlertTriangle },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/trade-entry", label: "Trade Entry", icon: PlusCircle },
  { href: "/paper-trading", label: "Paper Trading", icon: Sparkles },
  { href: "/charts", label: "Charts", icon: CandlestickChart },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur supports-[backdrop-filter]:bg-slate-950/60">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
            <LineChart className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-white">Echios</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">STP Platform</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition",
                  active
                    ? "bg-slate-800 text-white shadow-inner"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
