import clsx from "clsx";
import { CheckCircle2, Clock3, Filter, Layers, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardReportCard } from "@/components/HazardReportCard";
import { NavigationMap } from "@/components/map/MapBase";
import { HazardMarkers } from "@/components/map/layers";
import { Drawer, EmptyState, ErrorNote, LoadingSkeleton, PageHeader, StatCard } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { useApi } from "@/lib/hooks";
import { CATEGORIES, SEVERITY, STATUS } from "@/lib/meta";
import type { Incident, Severity, Status } from "@/lib/types";

interface Summary { total: number; active: number; pending: number; resolved: number }

export default function HazardMap() {
  const [params, setParams] = useSearchParams();
  const [cats, setCats] = useState<string[]>([]);
  const [sev, setSev] = useState<Severity | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const [state, setState] = useState<"active" | "resolved" | "all">("active");
  const [days, setDays] = useState<string>("");
  const [mode, setMode] = useState<"" | "walk" | "drive">("");
  const [showFilters, setShowFilters] = useState(false);

  const q = new URLSearchParams();
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
  const open = (id: number | null) => setParams(id ? { id: String(id) } : {});
  const items = list.data ?? [];
  const activeFilters = cats.length + (sev ? 1 : 0) + (status ? 1 : 0) + (days ? 1 : 0) + (mode ? 1 : 0);

  const toggleCat = (id: string) => setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const clear = () => { setCats([]); setSev(""); setStatus(""); setDays(""); setMode(""); };

  return (
    <div className="page">
      <PageHeader title="Community Hazard Map" subtitle="Hazards reported by the Cyberjaya community, verified by safety operators. Updates live." />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total hazards reported" value={summary.data?.total ?? "–"} icon={Layers} tone="lavender" onClick={() => setState("all")} />
        <StatCard label="Active hazards" value={summary.data?.active ?? "–"} icon={ShieldAlert} tone="rose" onClick={() => setState("active")} />
        <StatCard label="Pending verification" value={summary.data?.pending ?? "–"} icon={Clock3} tone="peach" onClick={() => { setState("all"); setStatus("pending_verification"); }} />
        <StatCard label="Resolved" value={summary.data?.resolved ?? "–"} icon={CheckCircle2} tone="mint" onClick={() => setState("resolved")} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="seg">
          {(["active", "resolved", "all"] as const).map((s) => (
            <button key={s} data-on={state === s} onClick={() => setState(s)} className="capitalize">{s}</button>
          ))}
        </div>
        <button className={clsx("btn-outline !py-2", activeFilters && "!ring-lavender-deep")} onClick={() => setShowFilters((s) => !s)}>
          <Filter size={15} />Filters{activeFilters ? ` · ${activeFilters}` : ""}
        </button>
        {activeFilters > 0 && <button className="btn-ghost !py-2 text-muted" onClick={clear}><X size={14} />Clear</button>}
        <span className="ml-auto text-sm text-muted">{items.length} shown</span>
      </div>

      {showFilters && (
        <div className="card card-pad mt-3 animate-rise">
          <div className="label mb-2">Category</div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => toggleCat(c.id)}
                className={clsx("chip !px-3 !py-1.5 ring-1 transition", cats.includes(c.id) ? "ring-2" : "ring-line bg-white text-muted")}
                style={cats.includes(c.id) ? { background: c.bg, color: c.color, ["--tw-ring-color" as string]: c.color } : undefined}>
                <c.icon size={13} />{c.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
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
        <NavigationMap className="h-[460px] lg:h-[640px]">
          <HazardMarkers items={items} onSelect={(i) => open(i.id)} selectedId={openId} />
        </NavigationMap>
        <section className="card card-pad lg:max-h-[640px] lg:overflow-y-auto scroll-thin">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Recent community reports</h2>
            <span className="text-xs text-muted">Dashed marker = unverified</span>
          </div>
          {list.error && <ErrorNote message={list.error} onRetry={() => list.reload()} />}
          {list.loading && !list.data ? <LoadingSkeleton rows={5} /> : items.length === 0 ? (
            <EmptyState title="No hazards match" text="Try clearing filters or switching to all reports." />
          ) : (
            <div className="space-y-2.5">{items.map((i) => <HazardReportCard key={i.id} inc={i} selected={i.id === openId} onClick={() => open(i.id)} />)}</div>
          )}
        </section>
      </div>
      <Drawer open={openId != null} onClose={() => open(null)}>{openId != null && <HazardDetailPanel id={openId} onClose={() => open(null)} />}</Drawer>
    </div>
  );
}
