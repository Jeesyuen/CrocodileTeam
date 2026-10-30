import clsx from "clsx";
import { CheckCircle2, ChevronRight, Clock3, Filter, Layers, MapPin, Navigation, Plus, Route as RouteIcon, ShieldAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardReportCard, HazardThumb } from "@/components/HazardReportCard";
import { NavigationMap } from "@/components/map/MapBase";
import { AffectedPathLines, HazardMarkers, RouteLine } from "@/components/map/layers";
import { OperatorActions } from "@/components/OperatorActions";
import { CertaintyBadge, Drawer, EmptyState, ErrorNote, IncidentStatusBadge, LoadingSkeleton, PageHeader, SeverityBadge, StatCard } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CATEGORIES, CERTAINTY, SEVERITY, STATUS } from "@/lib/meta";
import type { Certainty, Incident, Severity, Status } from "@/lib/types";

interface Summary { total: number; active: number; pending: number; resolved: number }

/** Lifecycle groups shown as quick filters; matches the marker styles on the map. */
const STAGES: { id: string; label: string; match: (c: Certainty) => boolean; dot: string; style: string }[] = [
  { id: "reported", label: "Unverified", match: (c) => c === "reported", dot: CERTAINTY.reported.color, style: "dashed border" },
  { id: "verified", label: "Verified", match: (c) => c === "verified", dot: CERTAINTY.verified.color, style: "solid border" },
  { id: "closure", label: "Closures", match: (c) => c === "confirmed_closure", dot: CERTAINTY.confirmed_closure.color, style: "red CLOSED tag" },
  { id: "resolved", label: "Resolved", match: (c) => c === "resolved", dot: CERTAINTY.resolved.color, style: "faded" },
];

export default function HazardMap() {
  const { user } = useAuth();
  const nav = useNav();
  const [params, setParams] = useSearchParams();
  const [cats, setCats] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [sev, setSev] = useState<Severity | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const [state, setState] = useState<"active" | "resolved" | "all">("active");
  const [days, setDays] = useState<string>("");
  const [mode, setMode] = useState<"" | "walk" | "drive">("");
  const [showFilters, setShowFilters] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [showRoute, setShowRoute] = useState(true);

  const q = new URLSearchParams({ paths: "true" });
  if (cats.length) q.set("category", cats.join(","));
  if (sev) q.set("severity", sev);
  if (status) q.set("status", status);
  if (state !== "all") q.set("state", state);
  if (days) q.set("days", days);
  if (mode) q.set("mode", mode);
  const list = useApi<Incident[]>(`/api/hazards?${q.toString()}`);
  const summary = useApi<Summary>("/api/dashboard/summary");
  useRealtimeEvent(["hazard.", "demo.reset"], () => { list.reload(true); summary.reload(true); });

  const openId = params.get("id") ? Number(params.get("id")) : null;
  const open = (id: number | null) => { setPreview(null); setParams(id ? { id: String(id) } : {}); };
  const all = list.data ?? [];
  const items = stages.length ? all.filter((i) => STAGES.some((s) => stages.includes(s.id) && s.match(i.certainty))) : all;
  const previewed = all.find((i) => i.id === preview) ?? null;
  const activeFilters = (sev ? 1 : 0) + (status ? 1 : 0) + (days ? 1 : 0) + (mode ? 1 : 0);
  const stageCount = (id: string) => all.filter((i) => STAGES.find((s) => s.id === id)!.match(i.certainty)).length;

  // the route the user planned in Smart Navigation, so hazards on it stand out here too
  const route = nav.plan?.routes.find((r) => r.preference === nav.selected) ?? null;
  const onRoute = useMemo(() => new Set(route?.hazard_ids ?? []), [route]);
  const onRouteCount = items.filter((i) => onRoute.has(i.id)).length;

  const toggle = (set: (f: (x: string[]) => string[]) => void, id: string) => set((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const clear = () => { setCats([]); setStages([]); setSev(""); setStatus(""); setDays(""); setMode(""); };
  const community = user?.role === "student" || user?.role === "driver";

  return (
    <div className="page">
      <PageHeader title="Community Hazard Map" subtitle="Hazards reported by the Cyberjaya community, verified by safety operators. Updates live."
        right={community ? <Link to="/report" className="btn-primary"><Plus size={16} />Report a hazard</Link>
          : user?.role === "operator" ? <Link to="/admin/verify" className="btn-soft">Open verification queue<ChevronRight size={15} /></Link> : undefined} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total hazards reported" value={summary.data?.total ?? "–"} icon={Layers} tone="lavender" onClick={() => setState("all")} />
        <StatCard label="Active hazards" value={summary.data?.active ?? "–"} icon={ShieldAlert} tone="rose" onClick={() => setState("active")} />
        <StatCard label="Pending verification" value={summary.data?.pending ?? "–"} icon={Clock3} tone="peach" onClick={() => { setState("all"); setStatus("pending_verification"); }} />
        <StatCard label="Resolved" value={summary.data?.resolved ?? "–"} icon={CheckCircle2} tone="mint" onClick={() => setState("resolved")} />
      </div>

      {/* quick filters: lifecycle stage + category, always visible */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="seg">
          {(["active", "resolved", "all"] as const).map((s) => (
            <button key={s} data-on={state === s} onClick={() => setState(s)} className="capitalize">{s}</button>
          ))}
        </div>
        {STAGES.map((s) => {
          const on = stages.includes(s.id);
          return (
            <button key={s.id} onClick={() => toggle(setStages, s.id)} aria-pressed={on} title={`Marker: ${s.style}`}
              className={clsx("chip !px-3 !py-1.5 ring-1 transition", on ? "bg-white ring-2 ring-ink/70" : "bg-white text-muted ring-line")}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} />{s.label} · {stageCount(s.id)}
            </button>
          );
        })}
        <button className={clsx("btn-outline !py-2", activeFilters && "!ring-lavender-deep")} onClick={() => setShowFilters((s) => !s)}>
          <Filter size={15} />More filters{activeFilters ? ` · ${activeFilters}` : ""}
        </button>
        {(activeFilters > 0 || cats.length > 0 || stages.length > 0) && <button className="btn-ghost !py-2 text-muted" onClick={clear}><X size={14} />Clear</button>}
        <span className="ml-auto text-sm text-muted">{items.length} shown</span>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scroll-thin" role="group" aria-label="Filter by category">
        {CATEGORIES.map((c) => {
          const on = cats.includes(c.id);
          return (
            <button key={c.id} onClick={() => toggle(setCats, c.id)} aria-pressed={on}
              className={clsx("chip shrink-0 !px-3 !py-1.5 ring-1 transition", on ? "ring-2" : "ring-line bg-white text-muted")}
              style={on ? { background: c.bg, color: c.color, ["--tw-ring-color" as string]: c.color } : undefined}>
              <c.icon size={13} />{c.label}
            </button>
          );
        })}
      </div>

      {showFilters && (
        <div className="card card-pad mt-3 animate-rise">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className="label">Severity</span>
              <select className="input mt-1 !py-2" value={sev} onChange={(e) => setSev(e.target.value as Severity)}>
                <option value="">Any</option>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></label>
            <label><span className="label">Verification status</span>
              <select className="input mt-1 !py-2" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="">Any</option>{Object.entries(STATUS).filter(([k]) => k !== "rejected").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></label>
            <label><span className="label">Reported within</span>
              <select className="input mt-1 !py-2" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="">Any time</option><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option>
              </select></label>
            <label><span className="label">Relevant to</span>
              <select className="input mt-1 !py-2" value={mode} onChange={(e) => setMode(e.target.value as "walk")}>
                <option value="">Everyone</option><option value="walk">Pedestrians</option><option value="drive">Drivers</option>
              </select></label>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <NavigationMap className="h-[460px] lg:h-[640px]" overlay={<>
          {route && (
            <div className="absolute left-3 top-3 z-[600] flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full bg-white/95 py-1.5 pl-3 pr-1.5 text-xs font-semibold shadow-soft">
              <RouteIcon size={14} className="shrink-0 text-lavender-deep" />
              <span className="truncate">Your {route.label}: {onRouteCount ? <span className="text-[#C4444E]">{onRouteCount} hazard{onRouteCount > 1 ? "s" : ""} on route</span> : "no hazards on route"}</span>
              <button className="rounded-full bg-canvas px-2 py-0.5" onClick={() => setShowRoute(!showRoute)}>{showRoute ? "Hide" : "Show"}</button>
            </div>
          )}
          {previewed && <PreviewCard inc={previewed} onRoute={onRoute.has(previewed.id)} onOpen={() => open(previewed.id)} onClose={() => setPreview(null)} />}
        </>}>
          {route && showRoute && <RouteLine route={route} active={false} />}
          <AffectedPathLines items={items.filter((i) => i.certainty !== "resolved")} onSelect={(i) => setPreview(i.id)} />
          <HazardMarkers items={items} cluster onSelect={(i) => setPreview(i.id)} selectedId={preview ?? openId} highlightIds={showRoute ? onRoute : undefined} />
        </NavigationMap>
        <section className="card card-pad lg:max-h-[640px] lg:overflow-y-auto scroll-thin">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-bold">Community reports</h2>
            <span className="text-right text-xs text-muted">Dashed = unverified · solid = verified · faded = resolved</span>
          </div>
          {list.error && <ErrorNote message={list.error} onRetry={() => list.reload()} />}
          {list.loading && !list.data ? <LoadingSkeleton rows={5} /> : items.length === 0 ? (
            <EmptyState title="No hazards match" text="Try clearing filters or switching to all reports." />
          ) : (
            <div className="space-y-2.5">{items.map((i) => <HazardReportCard key={i.id} inc={i} selected={i.id === openId || i.id === preview} onClick={() => open(i.id)} />)}</div>
          )}
        </section>
      </div>
      <Drawer open={openId != null} onClose={() => open(null)}>
        {openId != null && <HazardDetailPanel id={openId} onClose={() => open(null)}
          actions={user?.role === "operator" ? (d, r) => <OperatorActions d={d} reload={() => { r(); list.reload(true); summary.reload(true); }} /> : undefined} />}
      </Drawer>
    </div>
  );
}

function PreviewCard({ inc, onRoute, onOpen, onClose }: { inc: Incident; onRoute: boolean; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="absolute inset-x-3 bottom-10 z-[650] mx-auto max-w-md overflow-hidden rounded-3xl bg-white shadow-float animate-rise">
      <div className="flex gap-3 p-3">
        <HazardThumb inc={inc} className="h-24 w-24 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="mr-auto font-bold leading-snug">{inc.category_label}</h3>
            <SeverityBadge s={inc.severity} />
            <button className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted hover:bg-canvas" onClick={onClose} aria-label="Close preview"><X size={15} /></button>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted"><MapPin size={12} />{inc.location_label} · {timeAgo(inc.created_at)}</div>
          <div className="mt-1.5 flex flex-wrap gap-1"><CertaintyBadge c={inc.certainty} /><IncidentStatusBadge s={inc.status} /></div>
          {onRoute && <div className="mt-1.5 flex items-center gap-1 text-xs font-bold text-[#C4444E]"><Navigation size={12} />On your planned route</div>}
        </div>
      </div>
      <button className="flex w-full items-center justify-center gap-1 border-t border-line py-2.5 text-sm font-semibold text-lavender-deep hover:bg-canvas" onClick={onOpen}>
        View details, photos & history<ChevronRight size={15} />
      </button>
    </div>
  );
}
