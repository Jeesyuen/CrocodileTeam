import clsx from "clsx";
import { AlertTriangle, ArrowUpDown, Bike, Car, CloudRain, Footprints, Info, Loader2, Navigation, ShieldCheck, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Marker } from "react-leaflet";
import { useSearchParams } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { LocationSelector } from "@/components/LocationSelector";
import { NavigationMap } from "@/components/map/MapBase";
import { destIcon, HazardMarkers, RouteLines } from "@/components/map/layers";
import { RouteComparisonCard } from "@/components/RouteComparisonCard";
import { Drawer, EmptyState, ErrorNote, Modal, SafetyScoreBadge, Segmented, Skeleton } from "@/components/ui";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { fmtDuration, fmtTime, toLocalInput } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { categoryMeta } from "@/lib/meta";
import type { Incident, LatLon, Mode, Route } from "@/lib/types";

const DEMO_O: LatLon = { lat: 2.92787, lon: 101.6422422, label: "Multimedia University" };
const DEMO_D: LatLon = { lat: 2.9220744, lon: 101.6511202, label: "DPulze Shopping Centre" };
const DEMO_H: LatLon = { lat: 2.9204475, lon: 101.631591, label: "Hospital Cyberjaya" };

export default function NavigatePage() {
  const nav = useNav();
  const [params, setParams] = useSearchParams();
  const [pick, setPick] = useState<"origin" | "destination" | null>(null);
  const [hazardId, setHazardId] = useState<number | null>(null);
  const hazards = useApi<Incident[]>(`/api/hazards?state=active&mode=${nav.mode}`);
  useRealtimeEvent(["hazard.", "demo.reset"], () => hazards.reload(true));

  const { origin, destination, mode, findRoutes } = nav;
  useEffect(() => {
    if (origin && destination) findRoutes();
  }, [origin, destination, mode, nav.weather, nav.departAt, findRoutes]);

  const selected: Route | undefined = nav.plan?.routes.find((r) => r.preference === nav.selected) ?? nav.plan?.routes[0];
  const alertOpen = !!nav.alert && (params.get("alert") === "1" || !!nav.session);
  const routeHazards = useMemo(() => new Set(selected?.hazard_ids ?? []), [selected]);

  const onMapClick = (lat: number, lon: number) => {
    if (!pick) return;
    const p = { lat, lon, label: `Pinned point (${lat.toFixed(4)}, ${lon.toFixed(4)})` };
    if (pick === "origin") nav.setOrigin(p); else nav.setDestination(p);
    setPick(null);
  };

  const fit = selected?.geometry ?? (origin && destination ? [[origin.lat, origin.lon], [destination.lat, destination.lon]] as [number, number][] : null);

  return (
    <div className="relative flex flex-col lg:h-[calc(100vh-64px)] lg:flex-row lg:gap-5 lg:p-5">
      {/* planner panel */}
      <aside className="order-2 w-full space-y-4 p-4 pb-28 lg:order-1 lg:w-[420px] lg:shrink-0 lg:overflow-y-auto lg:p-0 lg:pb-0 scroll-thin">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-extrabold">Plan your trip</h1>
            <Segmented<Mode> value={nav.mode} onChange={nav.setMode}
              options={[{ value: "walk", label: <span className="flex items-center gap-1"><Footprints size={14} />Walk</span> },
                { value: "drive", label: <span className="flex items-center gap-1"><Car size={14} />Drive</span> }]} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <LocationSelector value={nav.origin} onChange={nav.setOrigin} placeholder="Starting point" dot="#3FAE97"
                onPickOnMap={() => setPick(pick === "origin" ? null : "origin")} picking={pick === "origin"} />
              <LocationSelector value={nav.destination} onChange={nav.setDestination} placeholder="Destination" dot="#7968C9"
                onPickOnMap={() => setPick(pick === "destination" ? null : "destination")} picking={pick === "destination"} />
            </div>
            <button onClick={nav.swap} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-canvas text-muted ring-1 ring-line hover:text-ink" aria-label="Swap start and destination">
              <ArrowUpDown size={15} />
            </button>
          </div>
          {nav.mode === "drive" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">Depart</span>
                <input type="datetime-local" className="input mt-1 !py-2" value={nav.departAt ?? ""} min={toLocalInput(new Date())}
                  onChange={(e) => nav.setDepartAt(e.target.value || null)} />
              </label>
              <label className="block">
                <span className="label">Weather scenario</span>
                <select className="input mt-1 !py-2" value={nav.weather} onChange={(e) => nav.setWeather(e.target.value as typeof nav.weather)}>
                  <option value="auto">Synthetic feed</option><option value="clear">Clear</option><option value="rain">Rain</option>
                </select>
              </label>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-1 rounded-full bg-canvas px-2 py-1" title="Planned — routing graph supports more modes">
              <Bike size={12} /> Cycling & motorcycle coming soon
            </span>
            {!nav.origin && !nav.destination && (
              <button className="font-semibold text-lavender-deep" onClick={() => { nav.setOrigin(DEMO_O); nav.setDestination(nav.mode === "drive" ? DEMO_H : DEMO_D); }}>
                Try a demo trip
              </button>
            )}
          </div>
        </div>

        {nav.session && selected && (
          <div className="card overflow-hidden">
            <div className="bg-mint p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-mint-deep"><span className="h-2 w-2 animate-pulse rounded-full bg-success" />Navigation active · live alerts on</div>
              <div className="mt-1 text-lg font-extrabold">{nav.session.destination.label ?? "Destination"}</div>
              <div className="text-sm text-ink/70">Arrive ≈ {fmtTime(selected.arrival)} · {fmtDuration(selected.duration_s)} · {selected.label}</div>
            </div>
            <div className="flex items-center justify-between p-3">
              <span className="text-xs text-muted">You'll be alerted if a hazard affects this route.</span>
              <button className="btn-danger !py-2" onClick={nav.endNavigation}><Square size={14} />End</button>
            </div>
          </div>
        )}

        {nav.error && <ErrorNote message={nav.error} onRetry={() => nav.findRoutes()} />}
        {nav.loading && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
        {!nav.loading && nav.plan && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-bold">Route options</h2>
              <span className="text-xs text-muted">{nav.plan.conditions.rain && <><CloudRain size={12} className="inline" /> rain · </>}{nav.plan.mode === "drive" ? "traffic-aware" : "pedestrian network"}</span>
            </div>
            {nav.plan.routes.map((r) => (
              <RouteComparisonCard key={r.preference} route={r} selected={r.preference === nav.selected}
                recommended={r.preference === nav.plan!.recommended} onSelect={() => nav.setSelected(r.preference as typeof nav.selected)} />
            ))}
            {!nav.session && (
              <button className="btn-primary w-full !py-3.5 text-base" onClick={nav.startNavigation}><Navigation size={18} />Start navigation</button>
            )}
            {nav.session && selected && nav.session.edge_ids.join() !== selected.edge_ids.join() && (
              <button className="btn-soft w-full" onClick={nav.startNavigation}>Switch navigation to {selected.label}</button>
            )}
            {selected && <SafetyBreakdown route={selected} />}
            {nav.plan.mode === "drive" && <p className="px-1 text-xs text-muted"><Info size={12} className="inline" /> Driving times use synthetic traffic forecasts (demo data), evaluated at the time you reach each road.</p>}
          </div>
        )}
        {!nav.loading && !nav.plan && !nav.error && (
          <div className="card"><EmptyState title="Choose where to go" text="Search a place or tap the cursor icon to drop a pin on the map. Routes follow real mapped Cyberjaya roads and footpaths." /></div>
        )}
      </aside>

      {/* map */}
      <div className="order-1 h-[52vh] p-3 lg:order-2 lg:h-auto lg:flex-1 lg:p-0">
        <NavigationMap className="h-full" onMapClick={pick ? onMapClick : undefined} fitTo={fit} fitKey={`${selected?.preference}-${selected?.distance_m}-${origin?.lat}-${destination?.lat}`}
          overlay={pick && (
            <div className="absolute left-1/2 top-4 z-[600] -translate-x-1/2 rounded-full bg-lavender-deep px-4 py-2 text-sm font-semibold text-white shadow-float">
              Tap the map to set your {pick === "origin" ? "starting point" : "destination"}
            </div>
          )}>
          {hazards.data && <HazardMarkers items={hazards.data} onSelect={(i) => setHazardId(i.id)} />}
          {nav.plan && <RouteLines plan={nav.plan} selected={nav.selected} onSelect={nav.setSelected} />}
          {!nav.plan && destination && <Marker position={[destination.lat, destination.lon]} icon={destIcon} />}
        </NavigationMap>
        {nav.loading && <div className="pointer-events-none absolute right-8 top-8 z-[600] hidden rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-soft lg:flex"><Loader2 size={14} className="mr-1 animate-spin" />Computing routes</div>}
        {selected && routeHazards.size > 0 && (
          <div className="pointer-events-none relative">
            <div className="pointer-events-auto absolute bottom-14 left-3 z-[600] max-w-xs rounded-3xl bg-white/95 p-3 shadow-float">
              <div className="flex items-center gap-2 text-xs font-bold text-[#C4444E]"><AlertTriangle size={14} />Hazards on this route</div>
              {hazards.data?.filter((h) => routeHazards.has(h.id)).map((h) => (
                <button key={h.id} className="mt-1 block text-left text-xs hover:underline" onClick={() => setHazardId(h.id)}>{h.category_label} · {h.location_label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal open={alertOpen} onClose={() => { nav.clearAlert(); setParams({}); }} title={nav.alert?.notification.title}>
        {nav.alert && <AlertBody />}
      </Modal>
      <Drawer open={hazardId != null} onClose={() => setHazardId(null)}>
        {hazardId != null && <HazardDetailPanel id={hazardId} onClose={() => setHazardId(null)} />}
      </Drawer>
    </div>
  );

  function AlertBody() {
    const a = nav.alert!;
    const m = categoryMeta(a.incident.category);
    return (
      <div>
        <div className="flex items-center gap-3 rounded-3xl p-4" style={{ background: m.bg }}>
          <m.icon size={28} color={m.color} />
          <div>
            <div className="font-bold">{a.incident.category_label}</div>
            <div className="text-sm text-muted">{a.incident.location_label} · {a.incident.certainty === "reported" ? "unverified report" : a.incident.certainty.replace("_", " ")}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink/80">{a.notification.message}</p>
        {a.alternative && (
          <div className="mt-3 flex items-center gap-3 rounded-3xl bg-mint p-3">
            <ShieldCheck size={20} className="text-mint-deep" />
            <div className="flex-1 text-sm"><b>Alternative:</b> {fmtDuration(a.alternative.duration_s)} · avoids the reported hazard</div>
            <SafetyScoreBadge score={a.alternative.safety.score} size="sm" />
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={() => { nav.clearAlert(); setParams({}); }}>Dismiss</button>
          <button className="btn-soft" onClick={() => { setHazardId(a.incident.id); }}>View hazard</button>
          {a.alternative && <button className="btn-primary" onClick={async () => { await nav.applyAlternative(); setParams({}); }}><Sparkles size={15} />Use alternative route</button>}
        </div>
      </div>
    );
  }
}

function SafetyBreakdown({ route }: { route: Route }) {
  const s = route.safety;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <SafetyScoreBadge score={s.score} size="lg" />
        <div>
          <div className="text-sm font-bold">Estimated safety · {route.label}</div>
          <div className="text-sm capitalize text-muted">{s.risk_level} estimated risk · data confidence {s.confidence_label}</div>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {s.factors.map((f) => (
          <div key={f.factor}>
            <div className="flex justify-between text-xs"><span className="font-semibold">{f.label} <span className="font-normal text-muted">· weight {Math.round(f.weight * 100)}%</span></span>
              <span className="text-muted">{f.known_share < 1 ? `${Math.round(f.known_share * 100)}% known` : ""}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
              <div className={clsx("h-full rounded-full", f.risk > 0.6 ? "bg-danger" : f.risk > 0.3 ? "bg-warning" : "bg-success")} style={{ width: `${Math.max(4, f.risk * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Heuristic score = 100 × (1 − weighted risk). It is not a validated accident probability. Missing lighting or surface data is
        counted as uncertainty, not as safe.
      </p>
    </div>
  );
}
