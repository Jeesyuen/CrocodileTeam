import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, tokenStore, wsUrl } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { useAuth } from "./AuthContext";

export interface RealtimeEvent { event: string; data: any; ts?: string }
type Listener = (e: RealtimeEvent) => void;
export type ConnState = "connecting" | "live" | "offline";

export interface Toast {
  id: string; title: string; message: string; priority: Notification["priority"];
  actions?: { label: string; onClick: () => void; primary?: boolean }[];
  sticky?: boolean;
}

interface RealtimeState {
  status: ConnState;
  unread: number;
  refreshUnread: () => void;
  subscribe: (fn: Listener) => () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<RealtimeState>(null!);
export const useRealtime = () => useContext(Ctx);

/** Subscribe to realtime events matching a prefix (e.g. "hazard.") while mounted. */
export function useRealtimeEvent(prefixes: string[], fn: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(fn);
  ref.current = fn;
  const key = prefixes.join("|");
  useEffect(() => subscribe((e) => {
    if (key.split("|").some((p) => e.event.startsWith(p))) ref.current(e);
  }), [subscribe, key]);
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnState>("offline");
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const listeners = useRef(new Set<Listener>());
  const seen = useRef(new Set<number>());

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    if (!t.sticky) setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 7000);
  }, []);

  const refreshUnread = useCallback(() => {
    api<{ unread: number }>("/api/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { setStatus("offline"); return; }
    refreshUnread();
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = tokenStore.get();
      if (!token || closed) return;
      setStatus("connecting");
      ws = new WebSocket(wsUrl(token));
      ws.onopen = () => {
        retry = 0;
        setStatus("live");
        refreshUnread(); // catch up on anything missed while disconnected
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25000);
      };
      ws.onmessage = (m) => {
        let e: RealtimeEvent;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.event === "pong" || e.event === "connected") return;
        const n: Notification | undefined = e.data?.notification;
        if (n) {
          if (seen.current.has(n.id)) return; // duplicate alert suppression on the client too
          seen.current.add(n.id);
          setUnread((u) => u + 1);
        }
        listeners.current.forEach((fn) => fn(e));
      };
      ws.onclose = (ev) => {
        clearInterval(ping);
        if (closed) return;
        setStatus("offline");
        if (ev.code === 4401) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 20000));
      };
    };
    connect();
    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(timer);
      ws?.close();
    };
  }, [user, refreshUnread]);

  return (
    <Ctx.Provider value={{ status, unread, refreshUnread, subscribe, toasts, pushToast, dismissToast }}>
      {children}
    </Ctx.Provider>
  );
}
