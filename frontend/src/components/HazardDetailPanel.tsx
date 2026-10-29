import clsx from "clsx";
import { Bot, Check, Footprints, Car, MapPin, X } from "lucide-react";
import { ReactNode } from "react";
import { Marker, Polyline } from "react-leaflet";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { assetUrl } from "@/lib/api";
import { fmtDateTime, timeAgo, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CERTAINTY, LIFECYCLE, RESTRICTION, STATUS } from "@/lib/meta";
import type { AIResult, IncidentDetail } from "@/lib/types";
import { HazardThumb } from "./HazardReportCard";
import { NavigationMap } from "./map/MapBase";
import { hazardIcon } from "./map/layers";
import { CertaintyBadge, ErrorNote, IncidentStatusBadge, LoadingSkeleton, Pill, SeverityBadge } from "./ui";

export function HazardDetailPanel({ id, onClose, actions }: {
  id: number; onClose: () => void; actions?: (d: IncidentDetail, reload: () => void) => ReactNode;
}) {
  const { data: d, error, loading, reload } = useApi<IncidentDetail>(`/api/hazards/${id}`);
  useRealtimeEvent(["hazard."], (e) => { if (e.data?.incident?.id === id) reload(true); });

  return (
    <div className="p-5 sm:p-7">
      <div className="mb-4 flex items-center justify-between">
        <span className="label">Hazard #{id}</span>
        <button onClick={onClose} className="btn-ghost h-9 w-9 !p-0" aria-label="Close"><X size={18} /></button>
      </div>
      {loading && !d && <LoadingSkeleton rows={4} />}
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {d && (
        <div className="space-y-5">
          <div className="overflow-hidden rounded-3xl bg-white shadow-soft">
            {d.images.length ? (
              <img src={assetUrl(d.images[0])} alt={`Photo of ${d.category_label}`} className="max-h-72 w-full object-cover" />
            ) : <HazardThumb inc={d} className="h-40 w-full" />}
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-xl font-extrabold">{d.category_label}</h2>
                <SeverityBadge s={d.severity} />
              </div>
              <div className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPin size={14} />{d.location_label} · {d.lat.toFixed(5)}, {d.lon.toFixed(5)}</div>
              <p className="mt-3 text-[15px]">{d.description || <span className="text-muted">No description provided.</span>}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <CertaintyBadge c={d.certainty} />
                <IncidentStatusBadge s={d.status} />
                <Pill color="#4F5560" bg="#EEF0F4">{RESTRICTION[d.restriction]}</Pill>
                {d.obstruction !== "unknown" && <Pill color="#4F5560" bg="#EEF0F4">Obstruction: {d.obstruction}</Pill>}
                {d.is_synthetic && <Pill color="#9A6418" bg="#FDEBD3">Synthetic demo record</Pill>}
              </div>
              <p className="mt-2 text-xs text-muted">{CERTAINTY[d.certainty].hint} Reported {timeAgo(d.created_at)} · {d.report_count} report{d.report_count > 1 ? "s" : ""}.</p>
            </div>
          </div>

          {actions && <div className="rounded-3xl bg-white p-5 shadow-soft">{actions(d, () => reload(true))}</div>}

          <NavigationMap className="h-56" fitTo={[[d.lat, d.lon], ...d.affected_paths.flatMap((a) => a.geometry)]} fitKey={`${d.id}-${d.lat}`} showLocate={false}>
            {d.affected_paths.map((a, i) => (
              <Polyline key={i} positions={a.geometry} pathOptions={{ color: a.impact_type === "closure" ? "#E2545E" : "#F4B860", weight: 7, opacity: a.active ? 0.9 : 0.35, dashArray: a.active ? undefined : "6 8" }} />
            ))}
            <Marker position={[d.lat, d.lon]} icon={hazardIcon(d, true)} />
          </NavigationMap>

          <section className="rounded-3xl bg-white p-5 shadow-soft">
            <h3 className="font-bold">Affected paths</h3>
            {d.match_quality === "none" ? (
              <p className="mt-2 text-sm text-muted">This location is not linked to a mapped path segment, so it does not affect routing. An operator can correct the location.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {d.impacts.map((im, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-canvas">{im.network === "walk" ? <Footprints size={15} /> : <Car size={15} />}</span>
                    <span className="flex-1">{d.affected_paths[i]?.road ?? "Unnamed path"} <span className="text-muted">· {im.network === "walk" ? "pedestrian" : "road"} · {im.distance_m} m from pin</span></span>
                    <Pill color={im.impact_type === "closure" ? "#C4444E" : "#B7791F"} bg={im.impact_type === "closure" ? "#FDE1E3" : "#FDF1DC"}>
                      {im.active ? titleCase(im.impact_type) : "Inactive"}
                    </Pill>
                  </li>
                ))}
                <li className="text-xs text-muted">Location match: {d.match_quality}.</li>
              </ul>
            )}
          </section>

          <AIBlock d={d} />

          <section className="rounded-3xl bg-white p-5 shadow-soft">
            <h3 className="font-bold">Status</h3>
            <LifecycleStepper status={d.status} />
            <h3 className="mt-5 font-bold">Incident history</h3>
            <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
              {[...d.history].reverse().map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-lavender-deep" />
                  <div className="text-sm font-semibold">{titleCase(h.action)}{h.to && <span className="font-normal text-muted"> → {STATUS[h.to as keyof typeof STATUS]?.label ?? h.to}</span>}</div>
                  <div className="text-xs text-muted">{h.actor}{h.actor_role ? ` (${h.actor_role})` : ""} · {fmtDateTime(h.at)}</div>
                  {h.note && <div className="mt-0.5 text-[13px] text-ink/80">{h.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

function AIBlock({ d }: { d: IncidentDetail }) {
  const analyses = d.reports.flatMap((r) => r.ai);
  if (!analyses.length) {
    return (
      <section className="rounded-3xl bg-white p-5 shadow-soft">
        <h3 className="flex items-center gap-2 font-bold"><Bot size={17} /> AI analysis</h3>
        <p className="mt-2 text-sm text-muted">No AI analysis for this report{d.images.length ? "" : " (no photo attached)"}.</p>
      </section>
    );
  }
  const a = analyses[analyses.length - 1].output as AIResult;
  return (
    <section className="rounded-3xl bg-lavender-soft p-5">
      <h3 className="flex items-center gap-2 font-bold text-lavender-deep"><Bot size={17} /> AI analysis <span className="chip bg-white text-muted">suggestion only</span></h3>
      {a.result ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Field k="Suggested type" v={titleCase(a.result.hazard_type)} />
          <Field k="Severity" v={titleCase(a.result.severity)} />
          <Field k="Blockage" v={titleCase(a.result.possible_blockage)} />
          <Field k="Confidence" v={`${Math.round(a.result.confidence * 100)}%`} />
          <p className="col-span-2 text-[13px] text-ink/80">{a.result.description}</p>
          <p className="col-span-2 text-xs text-muted">Model: {a.model} · {a.message}</p>
        </div>
      ) : <p className="mt-2 text-sm text-muted">{a.message}</p>}
    </section>
  );
}

const Field = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-2xl bg-white px-3 py-2"><div className="text-[11px] text-muted">{k}</div><div className="font-semibold">{v}</div></div>
);

export function LifecycleStepper({ status }: { status: IncidentDetail["status"] }) {
  const off = ["rejected", "duplicate", "expired_review"].includes(status);
  const idx = LIFECYCLE.indexOf(status);
  return (
    <div className="mt-3">
      {off && <div className="mb-2"><IncidentStatusBadge s={status} /></div>}
      <div className="flex items-center">
        {LIFECYCLE.map((s, i) => {
          const done = !off && i <= idx;
          return (
            <div key={s} className="flex flex-1 items-center last:flex-none">
              <span title={STATUS[s].label}
                className={clsx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                  done ? "bg-lavender-deep text-white" : "bg-line text-muted")}>
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {i < LIFECYCLE.length - 1 && <span className={clsx("mx-1 h-1 flex-1 rounded-full", !off && i < idx ? "bg-lavender-deep" : "bg-line")} />}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 hidden justify-between text-[10px] text-muted sm:flex">
        {LIFECYCLE.map((s) => <span key={s} className="w-14 text-center first:text-left last:text-right">{STATUS[s].label.split(" ")[0]}</span>)}
      </div>
    </div>
  );
}
