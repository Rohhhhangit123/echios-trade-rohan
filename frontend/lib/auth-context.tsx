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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PUBLIC_PATHS = ["/login", "/register", "/_next", "/favicon.ico"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [isLoading, setIsLoading] = useState<boolean>(() => !!getStoredToken());
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!user;

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
    if (getStoredToken()) {
      void refreshUser();
    }
  }, [refreshUser]);

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
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, []);

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
      isAuthenticated,
      isLoading,
      error,
      login,
      register,
      logout,
      refreshUser,
      hasRole,
    }),
    [user, isAuthenticated, isLoading, error, login, register, logout, refreshUser, hasRole],
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
