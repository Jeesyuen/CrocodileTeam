import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Incident, LatLon, Mode, Notification, Preference, Route, RoutePlan, RouteSession, Weather } from "@/lib/types";
import { useAuth } from "./AuthContext";
import { useRealtime, useRealtimeEvent } from "./RealtimeContext";

export interface RouteAlert { notification: Notification; incident: Incident; alternative: Route | null; session_id: number }

interface NavState {
  mode: Mode; setMode: (m: Mode) => void;
  origin: LatLon | null; setOrigin: (p: LatLon | null) => void;
  destination: LatLon | null; setDestination: (p: LatLon | null) => void;
  departAt: string | null; setDepartAt: (d: string | null) => void;
  weather: Weather; setWeather: (w: Weather) => void;
  plan: RoutePlan | null; loading: boolean; error: string | null;
  selected: Preference; setSelected: (p: Preference) => void;
  session: RouteSession | null; alert: RouteAlert | null; clearAlert: () => void;
  findRoutes: (opts?: { silent?: boolean; o?: LatLon; d?: LatLon; m?: Mode; depart?: string | null }) => Promise<RoutePlan | null>;
  startNavigation: () => Promise<void>;
  endNavigation: () => Promise<void>;
  applyAlternative: () => Promise<void>;
  swap: () => void;
}

const Ctx = createContext<NavState>(null!);
export const useNav = () => useContext(Ctx);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pushToast } = useRealtime();
  const navigate = useNavigate();
  const location = useLocation();
  const onNavigatePage = useRef(false);
  onNavigatePage.current = location.pathname === "/navigate";
  const [mode, setMode] = useState<Mode>("walk");
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [departAt, setDepartAt] = useState<string | null>(null);
  const [weather, setWeather] = useState<Weather>("auto");
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Preference>("balanced");
  const [session, setSession] = useState<RouteSession | null>(null);
  const [alert, setAlert] = useState<RouteAlert | null>(null);
  const state = useRef({ mode, origin, destination, departAt, weather });
  state.current = { mode, origin, destination, departAt, weather };

  useEffect(() => {
    let saved: Mode | undefined;
    try { saved = JSON.parse(localStorage.getItem("saferoute.prefs") ?? "{}").defaultMode; } catch { /* ignore */ }
    if (saved) setMode(saved);
    else if (user?.role === "driver") setMode("drive");
  }, [user]);

  const findRoutes = useCallback(async (opts: { silent?: boolean; o?: LatLon; d?: LatLon; m?: Mode; depart?: string | null } = {}) => {
    const s = state.current;
    const o = opts.o ?? s.origin, d = opts.d ?? s.destination, m = opts.m ?? s.mode;
    const depart = opts.depart !== undefined ? opts.depart : s.departAt;
    if (!o || !d) return null;
    if (!opts.silent) { setLoading(true); setError(null); }
    try {
      const p = await api<RoutePlan>("/api/routes/compare", {
        body: { mode: m, origin: o, destination: d, weather: s.weather, depart_at: m === "drive" && depart ? new Date(depart).toISOString() : null },
      });
      setPlan(p);
      if (!opts.silent) setSelected(p.recommended);
      return p;
    } catch (e) {
      if (!opts.silent) { setPlan(null); setError(e instanceof ApiError ? e.message : "Could not compute routes"); }
      return null;
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  // restore an in-progress navigation session after reload
  useEffect(() => {
    if (!user) { setSession(null); setPlan(null); return; }
    api<RouteSession | null>("/api/routes/sessions/active").then((s) => {
      if (!s) return;
      setSession(s);
      setMode(s.mode);
      setOrigin(s.origin);
      setDestination(s.destination);
      setSelected(s.preference);
      findRoutes({ silent: false, o: s.origin, d: s.destination, m: s.mode }).then(() => setSelected(s.preference));
    }).catch(() => {});
  }, [user, findRoutes]);

  const startNavigation = useCallback(async () => {
    if (!plan || !origin || !destination) return;
    const r = plan.routes.find((x) => x.preference === selected) ?? plan.routes[0];
    const s = await api<RouteSession>("/api/routes/sessions", {
      body: { mode: plan.mode, preference: selected, origin, destination, edge_ids: r.edge_ids, segment_ids: r.segment_ids },
    });
    setSession(s);
  }, [plan, origin, destination, selected]);

  const endNavigation = useCallback(async () => {
    if (session) await api(`/api/routes/sessions/${session.id}/end`, { method: "POST" }).catch(() => {});
    setSession(null);
    setAlert(null);
  }, [session]);

  const applyAlternative = useCallback(async () => {
    const alt = alert?.alternative;
    const p = await findRoutes({ silent: true });
    if (p && alt) {
      const match = p.routes.find((r) => r.edge_ids.join() === alt.edge_ids.join());
      const pref = (match?.preference ?? alt.preference) as Preference;
      setSelected(pref);
      const r = match ?? p.routes.find((x) => x.preference === pref) ?? p.routes[0];
      const o = state.current.origin, d = state.current.destination;
      if (o && d) {
        const s = await api<RouteSession>("/api/routes/sessions", {
          body: { mode: p.mode, preference: pref, origin: o, destination: d, edge_ids: r.edge_ids, segment_ids: r.segment_ids },
        });
        setSession(s);
      }
    }
    setAlert(null);
  }, [alert, findRoutes]);

  useRealtimeEvent(["route.affected"], (e) => {
    const a = e.data as RouteAlert;
    setAlert(a);
    findRoutes({ silent: true });
    if (onNavigatePage.current) return; // the Navigate page shows its own alert dialog
    pushToast({
      title: a.notification.title, message: a.notification.message, priority: a.notification.priority, sticky: true,
      actions: [
        { label: "View hazard", onClick: () => navigate(`/hazards?id=${a.incident.id}`) },
        ...(a.alternative ? [{ label: "View alternative", primary: true, onClick: () => navigate("/navigate?alert=1") }] : []),
      ],
    });
  });

  // conditions changed somewhere — refresh the displayed comparison
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  useRealtimeEvent(["hazard.", "demo.reset"], () => {
    if (!state.current.origin || !state.current.destination) return;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => findRoutes({ silent: true }), 700);
  });

  const swap = useCallback(() => {
    setOrigin(state.current.destination);
    setDestination(state.current.origin);
  }, []);

  return (
    <Ctx.Provider value={{
      mode, setMode, origin, setOrigin, destination, setDestination, departAt, setDepartAt, weather, setWeather,
      plan, loading, error, selected, setSelected, session, alert, clearAlert: () => setAlert(null),
      findRoutes, startNavigation, endNavigation, applyAlternative, swap,
    }}>
      {children}
    </Ctx.Provider>
  );
}
