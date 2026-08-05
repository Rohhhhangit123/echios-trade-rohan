"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  ChevronDown,
  LineChart,
  LogOut,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  CandlestickChart,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { UserRole } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Activity },
  { href: "/exceptions", label: "Exceptions", icon: AlertTriangle },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/trade-entry", label: "Trade Entry", icon: PlusCircle },
  { href: "/paper-trading", label: "Paper Trading", icon: Sparkles },
  { href: "/charts", label: "Charts", icon: CandlestickChart },
];

const ROLE_STYLES: Record<UserRole, string> = {
  ADMIN: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  TRADER: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  COMPLIANCE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  VIEWER: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

function roleIcon(role: UserRole) {
  if (role === "ADMIN") return ShieldCheck;
  return UserIcon;
}

function initials(name: string, email: string): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const byEmail = src.split("@")[0];
  if (!byEmail) return src[0].toUpperCase();
  if (byEmail.length >= 2) return byEmail.slice(0, 2).toUpperCase();
  return byEmail.toUpperCase();
}

export default function NavBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const RoleIcon = user ? roleIcon(user.role) : UserIcon;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur supports-[backdrop-filter]:bg-slate-950/60">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
            <LineChart className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-white">Echios</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">STP Platform</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 overflow-x-auto md:flex">
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
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="relative shrink-0">
            <button
              ref={btnRef}
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-sm transition hover:border-slate-700 hover:bg-slate-800/60"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500/80 to-violet-600/80 text-[11px] font-semibold text-white shadow-sm">
                {initials(user.full_name, user.email)}
              </div>
              <div className="hidden text-left sm:block">
                <div className="max-w-[140px] truncate text-xs font-medium text-white">
                  {user.full_name || user.email}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span
                    className={clsx(
                      "rounded-full border px-1.5 py-0.5 font-semibold uppercase tracking-wider",
                      ROLE_STYLES[user.role],
                    )}
                  >
                    {user.role}
                  </span>
                </div>
              </div>
              <ChevronDown
                className={clsx(
                  "hidden h-4 w-4 text-slate-400 transition sm:block",
                  menuOpen && "rotate-180",
                )}
              />
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                className="absolute right-0 mt-2 w-72 origin-top-right rounded-xl border border-slate-800 bg-slate-900/95 p-1 shadow-2xl shadow-black/50 backdrop-blur"
              >
                <div className="border-b border-slate-800/80 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/80 to-violet-600/80 text-sm font-semibold text-white shadow-sm">
                      {initials(user.full_name, user.email)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">
                        {user.full_name || "Unnamed User"}
                      </div>
                      <div className="truncate text-xs text-slate-400">{user.email}</div>
                      <div className={clsx("mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", ROLE_STYLES[user.role])}>
                        <RoleIcon className="h-3 w-3" />
                        {user.role}
                      </div>
                    </div>
                  </div>
                  {user.last_login_at && (
                    <div className="mt-3 text-[11px] text-slate-500">
                      Last login:{" "}
                      <span className="text-slate-400">
                        {new Date(user.last_login_at).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-800/60 px-4 py-2 sm:px-6 md:hidden lg:px-8">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition",
                active
                  ? "bg-slate-800 text-white shadow-inner"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
