import clsx from "clsx";
import { BellRing, CheckCheck, ClipboardList, Navigation, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState, ErrorNote, LoadingSkeleton, PageHeader } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useRealtime, useRealtimeEvent } from "@/context/RealtimeContext";
import { api } from "@/lib/api";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { PRIORITY } from "@/lib/meta";
import type { Notification } from "@/lib/types";

export default function Notifications() {
  const { user } = useAuth();
  const { refreshUnread } = useRealtime();
  const navigate = useNavigate();
  const { data, error, loading, reload, setData } = useApi<{ unread: number; items: Notification[] }>("/api/notifications");
  useRealtimeEvent(["route.affected", "notification.created"], () => reload(true));

  const markRead = async (n: Notification) => {
    if (n.read_at) return;
    const upd = await api<Notification>(`/api/notifications/${n.id}/read`, { method: "PATCH" });
    setData((d) => d && { unread: d.unread - 1, items: d.items.map((x) => (x.id === n.id ? upd : x)) });
    refreshUnread();
  };
  const markAll = async () => {
    await api("/api/notifications/read-all", { method: "POST" });
    reload(true); refreshUnread();
  };
  const open = (n: Notification) => {
    markRead(n);
    if (n.kind === "task.assigned" && n.data?.task_id) navigate(`/tasks/${n.data.task_id}`);
    else if (n.kind === "admin.queue" && n.incident_id) navigate(`/admin/verify?id=${n.incident_id}`);
    else if (n.incident_id) navigate(user?.role === "operator" ? `/admin/hazards?id=${n.incident_id}` : `/hazards?id=${n.incident_id}`);
  };

  return (
    <div className="page max-w-3xl">
      <PageHeader title="Notifications" subtitle="Route alerts, report updates and tasks."
        right={!!data?.unread && <button className="btn-soft" onClick={markAll}><CheckCheck size={16} />Mark all read</button>} />
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data ? <LoadingSkeleton rows={4} /> : !data?.items.length ? (
        <div className="card"><EmptyState title="You're all caught up" text="When a hazard affects your route, you'll be alerted here and in real time." /></div>
      ) : (
        <div className="space-y-2.5">
          {data.items.map((n) => {
            const p = PRIORITY[n.priority] ?? PRIORITY.medium;
            const Icon = n.kind === "route.affected" ? ShieldAlert : n.kind.startsWith("task") ? ClipboardList : BellRing;
            return (
              <div key={n.id} className={clsx("card flex gap-4 p-4 transition", !n.read_at && "ring-2 ring-lavender")}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: p.bg, color: p.color }}><Icon size={20} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{n.title}</span>
                    <span className="chip !py-0.5 text-[10px] uppercase" style={{ background: p.bg, color: p.color }}>{n.priority}</span>
                    {!n.read_at && <span className="h-2 w-2 rounded-full bg-lavender-deep" aria-label="unread" />}
                  </div>
                  <p className="mt-0.5 text-sm text-ink/80">{n.message}</p>
                  <div className="mt-1 text-xs text-muted" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {n.incident_id && <button className="btn-soft !px-3 !py-1.5 !text-xs" onClick={() => open(n)}>View {n.kind.startsWith("task") ? "task" : "hazard"}</button>}
                    {n.kind === "route.affected" && Boolean(n.data?.has_alternative) && (
                      <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => { markRead(n); navigate("/navigate"); }}><Navigation size={13} />View alternative route</button>
                    )}
                    {!n.read_at && <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => markRead(n)}>Mark read</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
