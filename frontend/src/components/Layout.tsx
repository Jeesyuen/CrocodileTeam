import clsx from "clsx";
import {
  Bell, BarChart3, ClipboardCheck, ClipboardList, FileText, Home, LayoutDashboard, LogOut, LucideIcon, Map, Navigation,
  Plus, Settings, ShieldAlert, TrafficCone, Wrench, X,
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useNav } from "@/context/NavigationContext";
import { useRealtime } from "@/context/RealtimeContext";
import { PRIORITY, ROLE_LABEL } from "@/lib/meta";
import type { Role } from "@/lib/types";
import { Logo } from "./Illustrations";
import { Avatar } from "./ui";

interface Item { to: string; label: string; icon: LucideIcon; end?: boolean }

const NAV: Record<Role, { section?: string; items: Item[] }[]> = {
  student: [{
    items: [
      { to: "/", label: "Overview", icon: Home, end: true },
      { to: "/navigate", label: "Smart Navigation", icon: Navigation },
      { to: "/traffic", label: "Traffic AI", icon: TrafficCone },
      { to: "/hazards", label: "Hazard Map", icon: Map },
      { to: "/report", label: "Report Hazard", icon: Plus },
      { to: "/my-reports", label: "My Reports", icon: FileText },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  }],
  driver: [],
  operator: [
    {
      section: "Operations", items: [
        { to: "/admin", label: "Admin Dashboard", icon: LayoutDashboard, end: true },
        { to: "/admin/verify", label: "Verification", icon: ClipboardCheck },
        { to: "/admin/hazards", label: "Hazard Management", icon: ShieldAlert },
        { to: "/admin/maintenance", label: "Maintenance", icon: Wrench },
        { to: "/admin/analytics", label: "Safety Analytics", icon: BarChart3 },
      ],
    },
    {
      section: "Mobility", items: [
        { to: "/hazards", label: "Hazard Map", icon: Map },
        { to: "/navigate", label: "Smart Navigation", icon: Navigation },
        { to: "/traffic", label: "Traffic AI", icon: TrafficCone },
        { to: "/notifications", label: "Notifications", icon: Bell },
      ],
    },
  ],
  maintenance: [{
    items: [
      { to: "/tasks", label: "Assigned Tasks", icon: ClipboardList },
      { to: "/hazards", label: "Hazard Map", icon: Map },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  }],
};
NAV.driver = NAV.student;

const MOBILE: Record<Role, Item[]> = {
  student: [
    { to: "/", label: "Home", icon: Home, end: true }, { to: "/navigate", label: "Navigate", icon: Navigation },
    { to: "/report", label: "Report", icon: Plus }, { to: "/hazards", label: "Hazards", icon: Map },
    { to: "/traffic", label: "Traffic", icon: TrafficCone },
  ],
  driver: [],
  operator: [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true }, { to: "/admin/verify", label: "Verify", icon: ClipboardCheck },
    { to: "/hazards", label: "Map", icon: Map }, { to: "/admin/maintenance", label: "Crews", icon: Wrench },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  ],
  maintenance: [
    { to: "/tasks", label: "Tasks", icon: ClipboardList }, { to: "/hazards", label: "Map", icon: Map },
    { to: "/notifications", label: "Alerts", icon: Bell },
  ],
};
MOBILE.driver = MOBILE.student;

export function AppSidebar() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col p-4 lg:flex">
      <div className="flex h-full flex-col rounded-4xl bg-white p-4 shadow-soft">
        <Link to="/" className="flex items-center gap-3 px-2 py-2">
          <Logo />
          <div>
            <div className="text-[15px] font-extrabold leading-tight">SafeRoute AI</div>
            <div className="text-[11px] text-muted">Cyberjaya pilot</div>
          </div>
        </Link>
        <nav className="mt-5 flex-1 space-y-5 overflow-y-auto scroll-thin">
          {NAV[user.role].map((g, gi) => (
            <div key={gi}>
              {g.section && <div className="label mb-2 px-3">{g.section}</div>}
              <div className="space-y-1">
                {g.items.map((it) => <SideLink key={it.to} {...it} />)}
              </div>
            </div>
          ))}
        </nav>
        <ActiveNavCard />
        <NavLink to="/profile" className={({ isActive }) => clsx("mt-3 flex items-center gap-3 rounded-2xl p-2 transition", isActive ? "bg-lavender" : "hover:bg-canvas")}>
          <Avatar name={user.name} color={user.avatar_color} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="text-xs text-muted">{ROLE_LABEL[user.role]}</div>
          </div>
          <Settings size={16} className="ml-auto text-muted" />
        </NavLink>
      </div>
    </aside>
  );
}

function SideLink({ to, label, icon: Icon, end }: Item) {
  const { unread } = useRealtime();
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => clsx("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition",
        isActive ? "bg-lavender text-lavender-deep" : "text-muted hover:bg-canvas hover:text-ink")}>
      <Icon size={18} strokeWidth={2.2} />
      <span className="flex-1">{label}</span>
      {to === "/notifications" && unread > 0 && <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
    </NavLink>
  );
}

function ActiveNavCard() {
  const { session, plan, selected } = useNav();
  if (!session) return null;
  const r = plan?.routes.find((x) => x.preference === selected);
  return (
    <Link to="/navigate" className="mt-3 block rounded-3xl bg-mint p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-mint-deep"><span className="h-2 w-2 animate-pulse rounded-full bg-success" />Navigating</div>
      <div className="mt-1 truncate text-sm font-semibold">{session.destination.label ?? "Destination"}</div>
      {r && <div className="text-xs text-muted">{Math.round(r.duration_s / 60)} min · {r.label}</div>}
    </Link>
  );
}

export function TopNavigation({ title }: { title: string }) {
  const { status, unread } = useRealtime();
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-[700] border-b border-line/60 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/" className="lg:hidden"><Logo className="h-8 w-8" /></Link>
        <h1 className="truncate text-base font-bold lg:hidden">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className={clsx("chip", status === "live" ? "bg-mint text-mint-deep" : status === "connecting" ? "bg-peach text-[#9A6418]" : "bg-line text-muted")}
            title="Real-time alert connection">
            <span className={clsx("h-1.5 w-1.5 rounded-full", status === "live" ? "bg-success animate-pulse" : status === "connecting" ? "bg-warning" : "bg-muted")} />
            {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
          </span>
          <Link to="/notifications" className="relative grid h-10 w-10 place-items-center rounded-2xl bg-white shadow-soft" aria-label={`Notifications (${unread} unread)`}>
            <Bell size={18} />
            {unread > 0 && <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          {user && <UserProfileMenu />}
        </div>
      </div>
    </header>
  );
}

export function UserProfileMenu() {
  const { user, logout } = useAuth();
  const { endNavigation } = useNav();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!user) return null;
  const signOut = async () => { await endNavigation(); logout(); navigate("/login"); };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-2xl bg-white p-1 pr-1 shadow-soft sm:pr-3" aria-label="Account menu">
        <Avatar name={user.name} color={user.avatar_color} size={32} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-[140px] truncate text-xs font-bold">{user.name}</span>
          <span className="block text-[10px] text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 rounded-3xl bg-white p-2 shadow-float animate-rise">
          <div className="px-3 py-2 text-xs text-muted">{user.email}</div>
          <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm hover:bg-canvas"><Settings size={16} />Profile & settings</Link>
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm hover:bg-canvas"><LogOut size={16} />Switch demo account</button>
        </div>
      )}
    </div>
  );
}

export function MobileBottomNavigation() {
  const { user } = useAuth();
  if (!user) return null;
  const items = MOBILE[user.role];
  return (
    <nav className="fixed inset-x-3 bottom-3 z-[800] rounded-4xl bg-white/95 p-2 shadow-float backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
      <div className="flex items-center justify-around">
        {items.map((it) => {
          const center = it.to === "/report";
          return (
            <NavLink key={it.to} to={it.to} end={it.end}
              className={({ isActive }) => clsx("flex flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 text-[10px] font-semibold",
                center ? "" : isActive ? "text-lavender-deep" : "text-muted")}>
              {({ isActive }) => center ? (
                <span className="-mt-7 grid h-14 w-14 place-items-center rounded-3xl bg-lavender-deep text-white shadow-float"><Plus size={24} /></span>
              ) : (
                <>
                  <span className={clsx("grid h-8 w-10 place-items-center rounded-xl", isActive && "bg-lavender")}><it.icon size={19} /></span>
                  {it.label}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export function NotificationToastStack() {
  const { toasts, dismissToast } = useRealtime();
  return (
    <div className="pointer-events-none fixed inset-x-3 top-20 z-[1300] flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:w-[380px]">
      {toasts.map((t) => {
        const p = PRIORITY[t.priority] ?? PRIORITY.medium;
        return (
          <div key={t.id} role="alert" className="pointer-events-auto w-full rounded-3xl bg-white p-4 shadow-float ring-1 ring-line animate-rise">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-2xl" style={{ background: p.bg, color: p.color }}><ShieldAlert size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{t.title}</span>
                  <span className="chip !px-2 !py-0.5 text-[10px] uppercase" style={{ background: p.bg, color: p.color }}>{t.priority}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-ink/80">{t.message}</p>
                {t.actions && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {t.actions.map((a) => (
                      <button key={a.label} className={a.primary ? "btn-primary !px-3 !py-1.5 !text-xs" : "btn-soft !px-3 !py-1.5 !text-xs"}
                        onClick={() => { a.onClick(); dismissToast(t.id); }}>{a.label}</button>
                    ))}
                    <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => dismissToast(t.id)}>Dismiss</button>
                  </div>
                )}
              </div>
              {!t.actions && <button onClick={() => dismissToast(t.id)} className="text-muted" aria-label="Dismiss"><X size={16} /></button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TITLES: Record<string, string> = {
  "/": "Overview", "/navigate": "Smart Navigation", "/traffic": "Traffic AI", "/hazards": "Hazard Map",
  "/report": "Report Hazard", "/my-reports": "My Reports", "/notifications": "Notifications", "/profile": "Profile",
  "/admin": "Admin Dashboard", "/admin/verify": "Verification", "/admin/hazards": "Hazard Management",
  "/admin/maintenance": "Maintenance", "/admin/analytics": "Safety Analytics", "/tasks": "Assigned Tasks",
};

export function AppLayout({ children }: { children?: ReactNode }) {
  const loc = useLocation();
  const title = TITLES[loc.pathname] ?? (loc.pathname.startsWith("/tasks") ? "Task Details" : "SafeRoute AI");
  useEffect(() => { document.title = `${title} · SafeRoute AI`; }, [title]);
  return (
    <div className="flex min-h-full">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNavigation title={title} />
        <main className="flex-1">{children ?? <Outlet />}</main>
      </div>
      <MobileBottomNavigation />
      <NotificationToastStack />
    </div>
  );
}
