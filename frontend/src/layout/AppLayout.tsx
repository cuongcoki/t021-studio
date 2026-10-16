import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  CircleHelp,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { ROLE_LABEL } from "@/lib/labels";
import type { Role } from "@/lib/api";
import { OnboardingGuide } from "./OnboardingGuide";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  end?: boolean;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Làm việc",
    items: [
      { to: "/", label: "Tổng quan", icon: LayoutDashboard, end: true },
      { to: "/projects", label: "Project", icon: FolderKanban },
      { to: "/tasks", label: "Task", icon: ClipboardList },
    ],
  },
  {
    section: "Hệ thống",
    items: [
      { to: "/users", label: "Tài khoản", icon: Users, roles: ["admin"] },
      { to: "/settings", label: "Cài đặt · CVAT", icon: Settings },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("t021-theme", dark ? "dark" : "light");
    } catch {
      /* private mode: theme just isn't remembered */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [dark, setDark] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [guide, setGuide] = useState(false);
  const location = useLocation();
  const inWorkspace = /^\/tasks\/[^/]+$/.test(location.pathname) || location.pathname === "/preview";

  const sidebar = (
    <div className="flex h-full w-60 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-black text-primary-foreground">
          T21
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-none text-sidebar-primary">Track ID QA</p>
          <p className="mt-0.5 text-[10px] text-sidebar-foreground">Annotation Quality Studio</p>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
        {NAV.map(({ section, items }) => {
          const visible = items.filter((i) => !i.roles || (user && i.roles.includes(user.role)));
          if (!visible.length) return null;
          return (
            <div key={section}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">{section}</p>
              <div className="space-y-0.5 rounded-2xl p-1">
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-full px-3 py-2 text-sm transition-colors ${
                        isActive || (item.to === "/tasks" && inWorkspace)
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            setGuide(true);
            setMobileOpen(false);
          }}
          className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <CircleHelp className="h-4 w-4 shrink-0" /> Hướng dẫn sử dụng
        </button>
      </div>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-2.5 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold uppercase text-primary">
            {user?.username.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user?.full_name || user?.username}</p>
            <p className="text-[11px] text-muted-foreground">{user && ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          <button type="button" onClick={() => setDark((d) => !d)} className="secondary-action h-8 flex-1 whitespace-nowrap px-2 text-xs" title="Đổi giao diện sáng / tối">
            {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Sáng" : "Tối"}
          </button>
          <button type="button" onClick={() => void logout()} className="secondary-action h-8 flex-[1.4] whitespace-nowrap px-2 text-xs">
            <LogOut size={14} /> Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="hidden shrink-0 lg:block">{sidebar}</aside>
      {user && <OnboardingGuide key={user.username} role={user.role} username={user.username} open={guide} onClose={() => setGuide(false)} />}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="relative">{sidebar}</div>
          <button type="button" aria-label="Đóng menu" className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)}>
            <X className="ml-3 mt-4 text-white" />
          </button>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3 lg:hidden">
          <button type="button" onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-muted" aria-label="Mở menu">
            <Menu size={18} />
          </button>
          <span className="ml-2 text-sm font-semibold">T021 Track ID QA</span>
        </div>
        <div className={`min-h-0 flex-1 ${inWorkspace ? "overflow-hidden" : "overflow-y-auto"}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
