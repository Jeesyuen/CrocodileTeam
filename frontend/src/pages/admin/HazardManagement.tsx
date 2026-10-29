import clsx from "clsx";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardThumb } from "@/components/HazardReportCard";
import { OperatorActions } from "@/components/OperatorActions";
import { CertaintyBadge, Drawer, EmptyState, ErrorNote, IncidentStatusBadge, LoadingSkeleton, PageHeader, SeverityBadge } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { RESTRICTION } from "@/lib/meta";
import type { Incident } from "@/lib/types";

const TABS = [
  { id: "active", label: "Active", q: "state=active" },
  { id: "closed", label: "Closures", q: "state=active" },
  { id: "resolved", label: "Resolved", q: "state=resolved" },
  { id: "rejected", label: "Rejected / duplicate", q: "status=rejected,duplicate" },
  { id: "all", label: "All", q: "" },
];

export default function HazardManagement() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("active");
  const [text, setText] = useState("");
  const t = TABS.find((x) => x.id === tab)!;
  const list = useApi<Incident[]>(`/api/hazards?${t.q}`);
  useRealtimeEvent(["hazard.", "demo.reset", "maintenance."], () => list.reload(true));
  const openId = params.get("id") ? Number(params.get("id")) : null;

  const items = useMemo(() => {
    let xs = list.data ?? [];
    if (tab === "closed") xs = xs.filter((i) => i.restriction === "closed");
    if (text) xs = xs.filter((i) => `${i.id} ${i.category_label} ${i.location_label} ${i.description}`.toLowerCase().includes(text.toLowerCase()));
    return xs;
  }, [list.data, tab, text]);

  return (
    <div className="page">
      <PageHeader title="Hazard management" subtitle="Every incident, its restriction and lifecycle. Click a row to act." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg">{TABS.map((x) => <button key={x.id} data-on={tab === x.id} onClick={() => setTab(x.id)}>{x.label}</button>)}</div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-10 !py-2.5" placeholder="Search by #, type or place" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>
      {list.error && <ErrorNote message={list.error} onRetry={() => list.reload()} />}
      <div className="card overflow-hidden">
        {list.loading && !list.data ? <div className="p-5"><LoadingSkeleton rows={6} /></div> : items.length === 0 ? <EmptyState title="Nothing here" /> : (
          <div className="divide-y divide-line">
            <div className="hidden grid-cols-[56px_1.6fr_1fr_1fr_1fr_90px] gap-3 px-5 py-3 text-xs font-semibold text-muted md:grid">
              <span /><span>Incident</span><span>Status</span><span>Restriction</span><span>Severity</span><span>Reported</span>
            </div>
            {items.map((i) => (
              <button key={i.id} onClick={() => setParams({ id: String(i.id) })}
                className={clsx("grid w-full grid-cols-[56px_1fr] items-center gap-3 px-5 py-3 text-left transition hover:bg-canvas md:grid-cols-[56px_1.6fr_1fr_1fr_1fr_90px]", openId === i.id && "bg-lavender-soft")}>
                <HazardThumb inc={i} className="h-12 w-12 rounded-2xl" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">#{i.id} · {i.category_label}</span>
                  <span className="block truncate text-xs text-muted">{i.location_label}{i.report_count > 1 ? ` · ${i.report_count} reports` : ""}{i.is_synthetic ? " · synthetic" : ""}</span>
                  <span className="mt-1 flex flex-wrap gap-1 md:hidden"><IncidentStatusBadge s={i.status} /><SeverityBadge s={i.severity} /></span>
                </span>
                <span className="hidden md:block"><IncidentStatusBadge s={i.status} /></span>
                <span className="hidden text-sm md:block">{i.restriction === "closed" ? <CertaintyBadge c="confirmed_closure" /> : RESTRICTION[i.restriction]}</span>
                <span className="hidden md:block"><SeverityBadge s={i.severity} /></span>
                <span className="hidden text-xs text-muted md:block">{timeAgo(i.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Drawer open={openId != null} onClose={() => setParams({})}>
        {openId != null && <HazardDetailPanel id={openId} onClose={() => setParams({})} actions={(d, r) => <OperatorActions d={d} reload={() => { r(); list.reload(true); }} />} />}
      </Drawer>
    </div>
  );
}
