import { ClipboardCheck, Hammer, UserPlus } from "lucide-react";
import { ReactNode, useState } from "react";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardThumb } from "@/components/HazardReportCard";
import { OperatorActions } from "@/components/OperatorActions";
import { Avatar, Drawer, LoadingSkeleton, PageHeader, SeverityBadge } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Incident, Task } from "@/lib/types";

export default function MaintenanceAssignment() {
  const verified = useApi<Incident[]>("/api/hazards?status=verified_active,in_progress,awaiting_clearance");
  const tasks = useApi<Task[]>("/api/maintenance/tasks");
  const staff = useApi<{ id: number; name: string; open_tasks: number }[]>("/api/maintenance/staff");
  const [open, setOpen] = useState<number | null>(null);
  const reload = () => { verified.reload(true); tasks.reload(true); staff.reload(true); };
  useRealtimeEvent(["hazard.", "maintenance.", "demo.reset"], reload);

  const openTaskInc = new Set((tasks.data ?? []).filter((t) => t.status !== "closed").map((t) => t.incident.id));
  const unassigned = (verified.data ?? []).filter((i) => !openTaskInc.has(i.id));
  const working = (tasks.data ?? []).filter((t) => t.status === "assigned" || t.status === "in_progress");
  const review = (tasks.data ?? []).filter((t) => t.status === "awaiting_clearance");

  return (
    <div className="page">
      <PageHeader title="Maintenance assignment" subtitle="Dispatch crews to verified hazards and review completion evidence before resolving." />
      <div className="mb-6 flex flex-wrap gap-3">
        {staff.data?.map((s) => (
          <div key={s.id} className="card flex items-center gap-3 px-4 py-3">
            <Avatar name={s.name} size={34} color="#FDEBD3" />
            <div><div className="text-sm font-bold">{s.name}</div><div className="text-xs text-muted">{s.open_tasks} open task{s.open_tasks === 1 ? "" : "s"}</div></div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Column title="Needs assignment" icon={<UserPlus size={17} />} count={unassigned.length} tone="bg-peach">
          {verified.loading && !verified.data ? <LoadingSkeleton /> : unassigned.map((i) => (
            <Card key={i.id} inc={i} onClick={() => setOpen(i.id)} meta={`Verified ${timeAgo(i.updated_at)}`} />
          ))}
        </Column>
        <Column title="In progress" icon={<Hammer size={17} />} count={working.length} tone="bg-sky">
          {working.map((t) => <Card key={t.id} inc={t.incident} onClick={() => setOpen(t.incident.id)} meta={`${t.assignee.name} · ${t.status.replace("_", " ")}`} />)}
        </Column>
        <Column title="Awaiting clearance" icon={<ClipboardCheck size={17} />} count={review.length} tone="bg-lavender">
          {review.map((t) => <Card key={t.id} inc={t.incident} onClick={() => setOpen(t.incident.id)} meta={`${t.assignee.name}: “${t.resolution_notes}”`} />)}
        </Column>
      </div>
      <Drawer open={open != null} onClose={() => setOpen(null)}>
        {open != null && <HazardDetailPanel id={open} onClose={() => setOpen(null)} actions={(d, r) => <OperatorActions d={d} reload={() => { r(); reload(); }} />} />}
      </Drawer>
    </div>
  );
}

function Column({ title, icon, count, tone, children }: { title: string; icon: ReactNode; count: number; tone: string; children: ReactNode }) {
  return (
    <section className="card card-pad">
      <div className="mb-3 flex items-center gap-2">
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${tone}`}>{icon}</span>
        <h2 className="font-bold">{title}</h2><span className="ml-auto chip bg-canvas text-muted">{count}</span>
      </div>
      <div className="space-y-2.5">{children}{count === 0 && <p className="py-6 text-center text-sm text-muted">Nothing here.</p>}</div>
    </section>
  );
}

function Card({ inc, meta, onClick }: { inc: Incident; meta: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full gap-3 rounded-3xl p-3 text-left ring-1 ring-line transition hover:shadow-soft">
      <HazardThumb inc={inc} className="h-14 w-14 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold">#{inc.id} {inc.category_label}</span><SeverityBadge s={inc.severity} /></div>
        <div className="truncate text-xs text-muted">{inc.location_label}</div>
        <div className="mt-1 line-clamp-1 text-xs text-ink/70">{meta}</div>
      </div>
    </button>
  );
}
