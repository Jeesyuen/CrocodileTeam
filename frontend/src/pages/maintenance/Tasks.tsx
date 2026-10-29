import clsx from "clsx";
import { ChevronRight, MapPin } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { HazardThumb } from "@/components/HazardReportCard";
import { NavigationMap } from "@/components/map/MapBase";
import { HazardMarkers } from "@/components/map/layers";
import { EmptyState, ErrorNote, LoadingSkeleton, PageHeader, SeverityBadge } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Task } from "@/lib/types";

export const TASK_STATUS: Record<Task["status"], { label: string; cls: string }> = {
  assigned: { label: "Assigned", cls: "bg-peach text-[#9A6418]" },
  in_progress: { label: "In progress", cls: "bg-sky text-sky-deep" },
  awaiting_clearance: { label: "Awaiting clearance", cls: "bg-lavender text-lavender-deep" },
  closed: { label: "Closed", cls: "bg-mint text-mint-deep" },
};

export default function Tasks() {
  const { data, error, loading, reload } = useApi<Task[]>("/api/maintenance/tasks");
  const [tab, setTab] = useState<"open" | "done">("open");
  useRealtimeEvent(["maintenance.", "hazard.", "notification.", "demo.reset"], () => reload(true));
  const items = (data ?? []).filter((t) => (tab === "open" ? t.status !== "closed" : t.status === "closed"));

  return (
    <div className="page">
      <PageHeader title="Assigned tasks" subtitle="Hazards dispatched to you by the safety operations team." />
      <div className="mb-4 seg">
        <button data-on={tab === "open"} onClick={() => setTab("open")}>Open</button>
        <button data-on={tab === "done"} onClick={() => setTab("done")}>Completed</button>
      </div>
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-3">
          {loading && !data ? <LoadingSkeleton rows={4} /> : items.length === 0 ? <div className="card"><EmptyState title={tab === "open" ? "No open tasks" : "No completed tasks yet"} /></div> : items.map((t) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className="card flex items-center gap-4 p-4 transition hover:shadow-float">
              <HazardThumb inc={t.incident} className="h-16 w-16 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{t.incident.category_label}</span><SeverityBadge s={t.priority} /></div>
                <div className="flex items-center gap-1 truncate text-xs text-muted"><MapPin size={12} />{t.incident.location_label}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={clsx("chip", TASK_STATUS[t.status].cls)}>{TASK_STATUS[t.status].label}</span>
                  <span className="text-xs text-muted">assigned {timeAgo(t.created_at)}</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          ))}
        </div>
        <NavigationMap className="h-[420px] lg:sticky lg:top-20">
          <HazardMarkers items={items.map((t) => t.incident)} />
        </NavigationMap>
      </div>
    </div>
  );
}
