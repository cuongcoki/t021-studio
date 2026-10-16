import { createContext, useContext } from "react";
import type { Role, User } from "./api";

export interface AuthState {
  user: User | null;
  /** First start: no account yet — the login form creates the Admin. */
  needsSetup: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** Role helpers matching the backend's checks (the backend is the real gate). */
export function usePermissions() {
  const role = useAuth().user?.role as Role | undefined;
  return {
    role,
    isAdmin: role === "admin",
    canEdit: role === "annotator",
    canReview: role === "reviewer",
    canCreateTask: role === "admin" || role === "annotator",
    canManageProjects: role === "admin" || role === "annotator",
  };
}
