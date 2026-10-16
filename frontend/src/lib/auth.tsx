import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";
import { AuthContext } from "./useAuth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const status = await fetch("/api/auth/status", { credentials: "same-origin" }).then((r) => r.json());
      setNeedsSetup(!!status.needs_setup);
      setUser((status.user as User | null) ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (username: string, password: string) => {
    if (needsSetup) {
      await api("auth/setup", { username, password });
      setNeedsSetup(false);
    }
    const res = await api<{ user: User }>("auth/login", { username, password });
    setUser(res.user);
  };

  const logout = async () => {
    await api("auth/logout").catch(() => undefined);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, needsSetup, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}
