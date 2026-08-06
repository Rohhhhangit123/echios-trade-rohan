"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User, UserRole } from "./types";
import {
  api,
  clearAuthStorage,
  getStoredToken,
  getStoredUser,
  setStoredToken,
  setStoredUser,
} from "./api";

interface AuthContextValue {
  user: User | null;
  realUser: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (
    email: string,
    password: string,
    fullName: string,
    role?: UserRole,
  ) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  viewRole: UserRole | null;
  setViewRole: (role: UserRole | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PUBLIC_PATHS = ["/login", "/register", "/_next", "/favicon.ico"];
const VIEW_ROLE_KEY = "echios_view_role_override";

function getStoredViewRole(): UserRole | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(VIEW_ROLE_KEY);
  return (raw as UserRole | null) ?? null;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Start with server-safe defaults (null/false) on every render so the first
  // client render matches SSR output exactly — localStorage/sessionStorage
  // values are only read after mount, in the effect below, to avoid a
  // hydration mismatch between server HTML and the client's first paint.
  const [realUser, setRealUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewRole, setViewRoleState] = useState<UserRole | null>(null);

  const isAuthenticated = !!realUser;

  // viewRole lets any signed-in user preview the app as a different persona
  // (nav + landing page only — there is no server-side authorization in this app).
  const user: User | null =
    realUser && viewRole ? { ...realUser, role: viewRole } : realUser;

  const setViewRole = useCallback((role: UserRole | null) => {
    setViewRoleState(role);
    if (typeof window === "undefined") return;
    if (role) {
      window.sessionStorage.setItem(VIEW_ROLE_KEY, role);
    } else {
      window.sessionStorage.removeItem(VIEW_ROLE_KEY);
    }
  }, []);

  const setUser = setRealUser;

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const me = await api.me();
      setUser(me);
      setStoredUser(me);
      setError(null);
    } catch (e: any) {
      clearAuthStorage();
      setUser(null);
      if (typeof window !== "undefined" && !isPublicPath(window.location.pathname)) {
        const current = encodeURIComponent(
          window.location.pathname + window.location.search,
        );
        window.location.href = `/login?next=${current}`;
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Runs once after mount, so the first client render matches SSR output
    // (both start from the null/false defaults above) before any
    // localStorage/sessionStorage value is applied.
    setViewRoleState(getStoredViewRole());
    const stored = getStoredUser();
    if (stored) setRealUser(stored);
    if (getStoredToken()) {
      void refreshUser();
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      setError(null);
      setIsLoading(true);
      try {
        const resp = await api.login({ email, password });
        setStoredToken(resp.access_token);
        setStoredUser(resp.user);
        setUser(resp.user);
        return resp.user;
      } catch (e: any) {
        const msg =
          e?.message?.includes("— ") ? e.message.split("— ")[1].replace(/"/g, "") : e.message || "Login failed";
        setError(msg);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      role?: UserRole,
    ): Promise<User> => {
      setError(null);
      setIsLoading(true);
      try {
        const resp = await api.register({
          email,
          password,
          full_name: fullName,
          role,
        });
        setStoredToken(resp.access_token);
        setStoredUser(resp.user);
        setUser(resp.user);
        return resp.user;
      } catch (e: any) {
        const msg =
          e?.message?.includes("— ") ? e.message.split("— ")[1].replace(/"/g, "") : e.message || "Registration failed";
        setError(msg);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    clearAuthStorage();
    setUser(null);
    setError(null);
    setViewRole(null);
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, [setViewRole]);

  const hasRole = useCallback(
    (...roles: UserRole[]) => {
      if (!user) return false;
      if (user.role === "ADMIN") return true;
      return roles.includes(user.role);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      realUser,
      isAuthenticated,
      isLoading,
      error,
      login,
      register,
      logout,
      refreshUser,
      hasRole,
      viewRole,
      setViewRole,
    }),
    [
      user,
      realUser,
      isAuthenticated,
      isLoading,
      error,
      login,
      register,
      logout,
      refreshUser,
      hasRole,
      viewRole,
      setViewRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
