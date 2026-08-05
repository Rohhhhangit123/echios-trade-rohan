import type { UserRole } from "./types";

export interface NavItemDef {
  href: string;
  label: string;
}

export const ALL_PAGES: NavItemDef[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/trade-entry", label: "Trade Entry" },
  { href: "/paper-trading", label: "Paper Trading" },
];

// Display label per role — kept separate from the backend UserRole enum value
// (ADMIN/TRADER/COMPLIANCE/VIEWER) so persona naming can change without a DB migration.
export const ROLE_DISPLAY_NAME: Record<UserRole, string> = {
  ADMIN: "Admin",
  TRADER: "Trader",
  COMPLIANCE: "Risk Manager",
  VIEWER: "Asset Manager",
};

// Pages each persona is wired to see. Admin always sees everything.
export const ROLE_PAGES: Record<UserRole, string[]> = {
  ADMIN: ALL_PAGES.map((p) => p.href),
  TRADER: ["/dashboard", "/trade-entry", "/paper-trading"],
  COMPLIANCE: ["/exceptions", "/dashboard"],
  VIEWER: ["/portfolio"],
};

// Where each persona lands after login / when hitting a page they can't see.
export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: "/dashboard",
  TRADER: "/dashboard",
  COMPLIANCE: "/exceptions",
  VIEWER: "/portfolio",
};

export function navItemsForRole(role: UserRole): NavItemDef[] {
  const allowed = new Set(ROLE_PAGES[role]);
  return ALL_PAGES.filter((p) => allowed.has(p.href));
}

export function canAccessPage(role: UserRole, pathname: string): boolean {
  return ROLE_PAGES[role].some((p) => pathname === p || pathname.startsWith(p + "/"));
}
