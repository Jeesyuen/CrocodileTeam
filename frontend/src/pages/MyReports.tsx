import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { HazardDetailPanel, LifecycleStepper } from "@/components/HazardDetailPanel";
import { HazardThumb } from "@/components/HazardReportCard";
import { CertaintyBadge, Drawer, EmptyState, ErrorNote, LoadingSkeleton, PageHeader, SeverityBadge } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { assetUrl } from "@/lib/api";
import { fmtDateTime, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { IncidentDetail, Severity } from "@/lib/types";

interface Mine { report_id: number; created_at: string; category: string; severity: Severity; description: string; merged: boolean; images: string[]; incident: IncidentDetail | null }

export default function MyReports() {
  const { data, error, loading, reload } = useApi<Mine[]>("/api/hazards/mine");
  const [open, setOpen] = useState<number | null>(null);
  useRealtimeEvent(["hazard."], () => reload(true));

  return (
    <div className="page max-w-4xl">
      <PageHeader title="My reports" subtitle="Track what happened to the hazards you reported." right={<Link to="/report" className="btn-primary"><Plus size={16} />New report</Link>} />
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data ? <LoadingSkeleton rows={4} /> : !data?.length ? (
        <div className="card"><EmptyState title="You haven't reported anything yet" text="Spotted a fallen tree, flood or pothole? Reporting takes about 30 seconds." action={<Link to="/report" className="btn-primary">Report a hazard</Link>} /></div>
      ) : (
        <div className="space-y-4">
          {data.map((r) => {
            const inc = r.incident;
            const last = inc?.history[inc.history.length - 1];
            return (
              <button key={r.report_id} onClick={() => inc && setOpen(inc.id)} className="card card-pad block w-full text-left transition hover:shadow-float">
                <div className="flex gap-4">
                  {r.images[0] ? <img src={assetUrl(r.images[0])} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" /> : <HazardThumb inc={{ category: r.category, image_url: null }} className="h-20 w-20 shrink-0 rounded-2xl" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{inc?.category_label ?? titleCase(r.category)}</span>
                      <SeverityBadge s={r.severity} />
                      {inc && <CertaintyBadge c={inc.certainty} />}
                      {r.merged && <span className="chip bg-sky text-sky-deep">Merged into #{inc?.id}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">Report #{r.report_id} · {fmtDateTime(r.created_at)} · {inc?.location_label}</div>
                    {r.description && <p className="mt-1 line-clamp-2 text-sm text-ink/80">{r.description}</p>}
                  </div>
                </div>
                {inc && <LifecycleStepper status={inc.status} />}
                {last && <p className="mt-3 rounded-2xl bg-canvas px-3 py-2 text-xs text-muted">Latest: <b className="text-ink">{titleCase(last.action)}</b> by {last.actor} · {fmtDateTime(last.at)}{last.note ? ` — ${last.note}` : ""}</p>}
              </button>
            );
          })}
        </div>
      )}
      <Drawer open={open != null} onClose={() => setOpen(null)}>{open != null && <HazardDetailPanel id={open} onClose={() => setOpen(null)} />}</Drawer>
    </div>
  );
}
