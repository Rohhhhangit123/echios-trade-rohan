"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  Eye,
  EyeOff,
  LineChart,
  Loader2,
  LogIn,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import clsx from "clsx";

const DEMO_USERS = [
  {
    email: "admin@echios.local",
    password: "admin123",
    role: "ADMIN",
    label: "Full platform access",
  },
  {
    email: "trader@echios.local",
    password: "trader123",
    role: "TRADER",
    label: "Enter & manage trades",
  },
  {
    email: "compliance@echios.local",
    password: "compliance123",
    role: "COMPLIANCE",
    label: "Review & resolve exceptions",
  },
  {
    email: "viewer@echios.local",
    password: "viewer123",
    role: "VIEWER",
    label: "Read-only dashboard",
  },
];

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  TRADER: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  COMPLIANCE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  VIEWER: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

const FEATURES = [
  { icon: Activity, title: "11-Stage Pipeline", desc: "Onboarding → execution → settlement → done with realtime stage tracking." },
  { icon: AlertTriangle, title: "Exceptions Queue", desc: "Auto-detect trade breaks, triage with GenAI, and track to resolution." },
  { icon: Briefcase, title: "Portfolio & P&L", desc: "Live position P&L, market value, cost basis, and nostro balances per client." },
  { icon: Sparkles, title: "GenAI Order Parsing", desc: "Paste natural-language trade instructions and let the AI parse them for you." },
];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const { login, isLoading, error } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim() || !password.trim()) {
      setFormError("Please enter your email and password.");
      return;
    }
    try {
      await login(email.trim(), password);
      router.replace(next);
    } catch {
    }
  };

  const fillDemo = (u: { email: string; password: string }) => {
    setEmail(u.email);
    setPassword(u.password);
    setFormError(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="relative min-h-screen">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.18),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(236,72,153,0.12),_transparent_55%)]"
        />
        <div className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
          <section className="order-2 flex flex-col justify-center lg:order-1">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
                <LineChart className="h-6 w-6 text-white" />
              </div>
              <div className="leading-tight">
                <div className="text-lg font-semibold tracking-tight text-white">Echios</div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">STP Trading Platform</div>
              </div>
            </div>

            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Straight-through trade settlement —{" "}
              <span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
                with guardrails.
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
              Sign in to manage trades, monitor the 11-stage lifecycle pipeline, triage exceptions,
              and track portfolio P&amp;L — all in one secure workspace.
            </p>

            <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 backdrop-blur"
                >
                  <dt className="flex items-center gap-2 text-sm font-medium text-white">
                    <f.icon className="h-4 w-4 text-indigo-400" />
                    {f.title}
                  </dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-slate-400">{f.desc}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Data stays local by default (SQLite-only). No cloud DB unless you opt in.</span>
            </div>
          </section>

          <section className="order-1 flex flex-col justify-center lg:order-2">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 shadow-2xl shadow-indigo-950/40 backdrop-blur sm:p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-white">
                    {mode === "login" ? "Welcome back" : "Create your account"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {mode === "login"
                      ? "Sign in to access your dashboard."
                      : "First user registered becomes ADMIN."}
                  </p>
                </div>
                <div className="flex rounded-lg border border-slate-800 bg-slate-950/70 p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setFormError(null);
                    }}
                    className={clsx(
                      "rounded-md px-3 py-1.5 transition",
                      mode === "login"
                        ? "bg-slate-800 text-white shadow-inner"
                        : "text-slate-400 hover:text-slate-200",
                    )}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("register");
                      setFormError(null);
                    }}
                    className={clsx(
                      "rounded-md px-3 py-1.5 transition",
                      mode === "register"
                        ? "bg-slate-800 text-white shadow-inner"
                        : "text-slate-400 hover:text-slate-200",
                    )}
                  >
                    Register
                  </button>
                </div>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5 pr-10 text-sm text-white placeholder:text-slate-600 focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {(error || formError) && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300">
                    {formError || error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {mode === "login" ? "Signing in…" : "Creating account…"}
                    </>
                  ) : (
                    <>
                      {mode === "login" ? (
                        <LogIn className="h-4 w-4" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      {mode === "login" ? "Sign in" : "Create account"}
                    </>
                  )}
                </button>
              </form>

              {mode === "login" && (
                <>
                  <div className="my-6 flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-800" />
                    <span className="text-[11px] uppercase tracking-widest text-slate-500">
                      Demo accounts
                    </span>
                    <div className="h-px flex-1 bg-slate-800" />
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DEMO_USERS.map((u) => (
                      <button
                        key={u.email}
                        type="button"
                        onClick={() => fillDemo(u)}
                        className="group flex flex-col items-start rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-left transition hover:border-indigo-500/40 hover:bg-slate-900"
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-slate-200 group-hover:text-white">
                            {u.email}
                          </span>
                          <span
                            className={clsx(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              ROLE_STYLES[u.role],
                            )}
                          >
                            {u.role}
                          </span>
                        </div>
                        <span className="mt-1 text-[11px] text-slate-500">{u.label}</span>
                      </button>
                    ))}
                  </div>

                  <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
                    Default admin seeded on first start: <span className="text-slate-400">admin@echios.local / admin123</span>.
                    Demo users: trader / compliance / viewer (passwords: trader123, compliance123, viewer123).
                    Change defaults after first login.
                  </p>
                </>
              )}
            </div>

            <p className="mt-6 text-center text-xs text-slate-500">
              Need help? Check the API docs at{" "}
              <Link
                href="http://localhost:8000/docs"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300"
              >
                localhost:8000/docs
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
