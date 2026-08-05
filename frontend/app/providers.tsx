"use client";

import { Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import NavBar from "@/components/NavBar";

const PUBLIC_PATHS = ["/login", "/register"];

function ShellInner({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  useEffect(() => {
    if (isLoading) return;
    if (isPublic) {
      if (isAuthenticated) {
        const sp = new URLSearchParams(window.location.search);
        const next = sp.get("next") || "/dashboard";
        router.replace(next);
      }
      return;
    }
    if (!isAuthenticated) {
      const next = encodeURIComponent(pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [isAuthenticated, isLoading, isPublic, pathname, router]);

  if (isLoading && !isPublic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (isPublic) {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
