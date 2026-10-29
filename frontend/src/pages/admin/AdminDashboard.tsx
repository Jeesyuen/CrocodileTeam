import { AlertOctagon, ArrowRight, CheckCircle2, Clock3, Layers, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";
import { Polyline } from "react-leaflet";
import { Link, useNavigate } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardReportCard } from "@/components/HazardReportCard";
import { NavigationMap } from "@/components/map/MapBase";
import { HazardMarkers } from "@/components/map/layers";
import { OperatorActions } from "@/components/OperatorActions";
import { ConfirmationDialog, Drawer, EmptyState, LoadingSkeleton, PageHeader, SectionHeader, StatCard, SyntheticBadge } from "@/components/ui";
import { useRealtime, useRealtimeEvent } from "@/context/RealtimeContext";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Incident, Task } from "@/lib/types";

interface Summary { total: number; active: number; pending: number; resolved: number; critical: number; closures: number; in_progress: number }

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { pushToast } = useRealtime();
  const summary = useApi<Summary>("/api/dashboard/summary");
  const active = useApi<Incident[]>("/api/hazards?state=active");
  const sessions = useApi<{ id: number; mode: string; geometry: [number, number][] }[]>("/api/admin/sessions");
  const tasks = useApi<Task[]>("/api/maintenance/tasks");
  const [open, setOpen] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const reloadAll = () => { summary.reload(true); active.reload(true); sessions.reload(true); tasks.reload(true); };
  useRealtimeEvent(["hazard.", "maintenance.", "demo.reset", "route."], reloadAll);

  const queue = (active.data ?? []).filter((i) => ["pending_verification", "submitted", "expired_review"].includes(i.status));
  const s = summary.data;
  const awaiting = (tasks.data ?? []).filter((t) => t.status === "awaiting_clearance");

  const reset = async () => {
    setResetting(true);
    try {
      await api("/api/admin/reset-demo", { method: "POST" });
      pushToast({ title: "Demo data reset", message: "Synthetic hazards and accounts restored.", priority: "low" });
      reloadAll();
    } finally { setResetting(false); setConfirmReset(false); }
  };

  return (
    <div className="page">
      <PageHeader title="Safety operations" subtitle="Verify community reports, manage restrictions and coordinate maintenance across the Cyberjaya pilot."
        right={<button className="btn-outline" onClick={() => setConfirmReset(true)}><RotateCcw size={15} />Reset demo data</button>} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Total incidents" value={s?.total ?? "–"} icon={Layers} tone="lavender" onClick={() => navigate("/admin/hazards")} />
        <StatCard label="Pending verification" value={s?.pending ?? "–"} icon={Clock3} tone="peach" onClick={() => navigate("/admin/verify")} />
        <StatCard label="Active" value={s?.active ?? "–"} icon={ShieldAlert} tone="sky" onClick={() => navigate("/admin/hazards")} />
        <StatCard label="Critical" value={s?.critical ?? "–"} icon={AlertOctagon} tone="rose" hint={s ? `${s.closures} path closure${s.closures === 1 ? "" : "s"}` : undefined} />
        <StatCard label="Resolved" value={s?.resolved ?? "–"} icon={CheckCircle2} tone="mint" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className="card card-pad">
          <SectionHeader title="Incident map" subtitle={`${active.data?.length ?? 0} active incidents · ${sessions.data?.length ?? 0} active navigation sessions (anonymised)`} right={<SyntheticBadge label="Includes synthetic records" />} />
          <NavigationMap className="h-[460px]">
            {sessions.data?.map((x) => <Polyline key={x.id} positions={x.geometry} pathOptions={{ color: "#7968C9", weight: 3, opacity: 0.45, dashArray: "2 6" }} />)}
            {active.data && <HazardMarkers items={active.data} onSelect={(i) => setOpen(i.id)} />}
          </NavigationMap>
        </section>
        <div className="space-y-6">
          <section className="card card-pad">
            <SectionHeader title="Verification queue" right={<Link to="/admin/verify" className="btn-soft !py-2">Open <ArrowRight size={15} /></Link>} />
            {active.loading && !active.data ? <LoadingSkeleton /> : queue.length === 0 ? <EmptyState title="Queue is clear" text="No reports waiting for verification." /> : (
              <div className="space-y-2.5">{queue.slice(0, 4).map((i) => <HazardReportCard key={i.id} inc={i} onClick={() => setOpen(i.id)} />)}</div>
            )}
          </section>
          <section className="card card-pad">
            <SectionHeader title="Awaiting clearance" subtitle="Maintenance has finished — review and resolve" right={<Link to="/admin/maintenance" className="text-sm font-semibold text-lavender-deep">All tasks</Link>} />
            {awaiting.length === 0 ? <p className="text-sm text-muted">Nothing to review.</p> : (
              <div className="space-y-2">
                {awaiting.map((t) => (
                  <button key={t.id} onClick={() => setOpen(t.incident.id)} className="flex w-full items-center gap-3 rounded-2xl bg-lavender-soft px-3 py-2.5 text-left">
                    <Wrench size={16} className="text-lavender-deep" />
                    <span className="flex-1 text-sm"><b>{t.incident.category_label}</b> · {t.assignee.name}</span>
                    <ArrowRight size={15} className="text-muted" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <Drawer open={open != null} onClose={() => setOpen(null)}>
        {open != null && <HazardDetailPanel id={open} onClose={() => setOpen(null)} actions={(d, r) => <OperatorActions d={d} reload={() => { r(); reloadAll(); }} />} />}
      </Drawer>
      <ConfirmationDialog open={confirmReset} title="Reset demo data?" danger confirmLabel="Reset" busy={resetting}
        text="Deletes all reports, incidents, notifications, tasks and navigation sessions, then restores the synthetic demo dataset. Road network and traffic history are kept."
        onClose={() => setConfirmReset(false)} onConfirm={reset} />
    </div>
  );
}
