import clsx from "clsx";
import {
  AlertTriangle, ArrowRight, ArrowUpDown, Bike, Car, ChevronDown, ChevronUp, CloudRain, Footprints, Info, Layers, Loader2,
  Navigation, Route as RouteIcon, ShieldCheck, Sparkles, Square, X,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { LocationSelector } from "@/components/LocationSelector";
import { NavigationMap } from "@/components/map/MapBase";
import { AffectedPathLines, destIcon, GhostRoute, HazardMarkers, RouteLines } from "@/components/map/layers";
import { MapMarker } from "@/components/map/primitives";
import { RouteComparisonCard, routeDelta } from "@/components/RouteComparisonCard";
import { Drawer, EmptyState, ErrorNote, Modal, SafetyScoreBadge, Segmented, Skeleton } from "@/components/ui";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { fmtDistance, fmtDuration, fmtTime, toLocalInput } from "@/lib/format";
import { useApi, useMediaQuery } from "@/lib/hooks";
import { categoryMeta, ROUTE_STYLE } from "@/lib/meta";
import type { Incident, LatLon, Mode, Route } from "@/lib/types";

const DEMO_O: LatLon = { lat: 2.92787, lon: 101.6422422, label: "Multimedia University" };
const DEMO_D: LatLon = { lat: 2.9220744, lon: 101.6511202, label: "DPulze Shopping Centre" };
const DEMO_H: LatLon = { lat: 2.9204475, lon: 101.631591, label: "Hospital Cyberjaya" };

export default function NavigatePage() {
  const nav = useNav();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [params, setParams] = useSearchParams();
  const [pick, setPick] = useState<"origin" | "destination" | null>(null);
  const [hazardId, setHazardId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [legend, setLegend] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const hazards = useApi<Incident[]>(`/api/hazards?state=active&mode=${nav.mode}&paths=true`);
  useRealtimeEvent(["hazard.", "demo.reset"], () => hazards.reload(true));

  const { origin, destination, mode, findRoutes } = nav;
  useEffect(() => {
    if (origin && destination) findRoutes();
  }, [origin, destination, mode, nav.weather, nav.departAt, findRoutes]);

  // mobile: once routes are available, collapse the sheet so the map and route pills are visible
  const hasPlan = !!nav.plan;
  useEffect(() => { if (hasPlan && !desktop) setSheetOpen(false); }, [hasPlan, desktop]);

  // bring the reroute comparison into view when it appears
  useEffect(() => {
    if (nav.reroute) { scroller.current?.scrollTo({ top: 0, behavior: "smooth" }); setSheetOpen(true); }
  }, [nav.reroute]);

  const selected: Route | undefined = nav.plan?.routes.find((r) => r.preference === nav.selected) ?? nav.plan?.routes[0];
  const recommended = nav.plan?.routes.find((r) => r.preference === nav.plan?.recommended) ?? null;
  const alertOpen = !!nav.alert && (params.get("alert") === "1" || !!nav.session);
  const routeHazards = useMemo(() => new Set(selected?.hazard_ids ?? []), [selected]);
  const onRoute = hazards.data?.filter((h) => routeHazards.has(h.id)) ?? [];
  const closures = hazards.data?.filter((h) => h.restriction === "closed").length ?? 0;
  const following = !!(nav.session && selected && nav.session.edge_ids.join() === selected.edge_ids.join());

  const onMapClick = (lat: number, lon: number) => {
    if (!pick) return;
    const p = { lat, lon, label: `Pinned point (${lat.toFixed(4)}, ${lon.toFixed(4)})` };
    if (pick === "origin") nav.setOrigin(p); else nav.setDestination(p);
    setPick(null);
    setSheetOpen(true);
  };
  const startPick = (which: "origin" | "destination") => {
    setPick(pick === which ? null : which);
    if (!desktop) setSheetOpen(false);
  };

  // bounds only (never drawn): the selected route, or the two chosen points
  const fit = selected?.geometry ?? (origin && destination ? [[origin.lat, origin.lon], [destination.lat, destination.lon]] as [number, number][] : null);

  const planner = (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold">Plan your trip</h1>
        <Segmented<Mode> value={nav.mode} onChange={nav.setMode}
          options={[{ value: "walk", label: <span className="flex items-center gap-1"><Footprints size={14} />Walk</span> },
            { value: "drive", label: <span className="flex items-center gap-1"><Car size={14} />Drive</span> }]} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <LocationSelector value={nav.origin} onChange={nav.setOrigin} placeholder="Starting point" dot="#3FAE97"
            onPickOnMap={() => startPick("origin")} picking={pick === "origin"} />
          <LocationSelector value={nav.destination} onChange={nav.setDestination} placeholder="Destination" dot="#7968C9"
            onPickOnMap={() => startPick("destination")} picking={pick === "destination"} />
        </div>
        <button onClick={nav.swap} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-canvas text-muted ring-1 ring-line hover:text-ink" aria-label="Swap start and destination">
          <ArrowUpDown size={15} />
        </button>
      </div>
      {nav.mode === "drive" && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
  );

  const panel = (
    <>
      {planner}
      {nav.session && selected && <SessionCard route={following ? selected : null} />}
      {nav.reroute && <RerouteCard />}

      {nav.error && <ErrorNote message={nav.error} onRetry={() => nav.findRoutes()} />}
      {nav.loading && <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}
      {!nav.loading && nav.plan && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-bold">Route options</h2>
            <span className="text-xs text-muted">{nav.plan.conditions.rain && <><CloudRain size={12} className="inline" /> rain · </>}{nav.plan.mode === "drive" ? "traffic-aware · road network" : "pedestrian network"}</span>
          </div>
          {recommended && (
            <div className="flex items-start gap-2 rounded-3xl bg-lavender-soft px-4 py-3 text-[13px] leading-relaxed">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-lavender-deep" />
              <span><b>{recommended.label}</b> is recommended: the best trade-off between journey time and estimated safety for this trip. Tap a route to show it on the map.</span>
            </div>
          )}
          {nav.plan.routes.map((r) => (
            <RouteComparisonCard key={r.preference} route={r} selected={r.preference === nav.selected}
              recommended={r.preference === nav.plan!.recommended} compareTo={recommended}
              compareLabel={recommended?.label} onSelect={() => nav.setSelected(r.preference as typeof nav.selected)} />
          ))}
          {closures > 0 && (
            <p className="flex items-start gap-1.5 px-1 text-xs text-muted"><Info size={13} className="mt-0.5 shrink-0" />
              {closures} confirmed closure{closures > 1 ? "s" : ""} in the area {closures > 1 ? "are" : "is"} excluded from every route (red dashed on the map).</p>
          )}
          {!nav.session && (
            <button className="btn-primary w-full !py-3.5 text-base" onClick={nav.startNavigation}><Navigation size={18} />Start navigation · {selected?.label}</button>
          )}
          {nav.session && selected && !following && (
            <button className="btn-soft w-full" onClick={nav.startNavigation}>Switch navigation to {selected.label}</button>
          )}
          {selected && <SafetyBreakdown route={selected} />}
          {nav.plan.mode === "drive" && <p className="px-1 text-xs text-muted"><Info size={12} className="inline" /> Driving times use synthetic traffic forecasts (demo data), evaluated at the time you reach each road.</p>}
        </div>
      )}
      {!nav.loading && !nav.plan && !nav.error && (
        <div className="card"><EmptyState title="Choose where to go" text="Search a place or tap the cursor icon to drop a pin on the map. Routes follow real mapped Cyberjaya roads and footpaths." /></div>
      )}
    </>
  );

  const map = (
    <NavigationMap className="h-full !rounded-none lg:!rounded-4xl" onMapClick={pick ? onMapClick : undefined} fitTo={fit}
      fitKey={`${selected?.preference}-${selected?.distance_m}-${origin?.lat}-${destination?.lat}`}
      overlay={<>
        {pick && (
          <div className="absolute left-1/2 top-4 z-[600] -translate-x-1/2 whitespace-nowrap rounded-full bg-lavender-deep px-4 py-2 text-sm font-semibold text-white shadow-float">
            Tap the map to set your {pick === "origin" ? "starting point" : "destination"}
          </div>
        )}
        <MapLegend open={legend} onToggle={() => setLegend(!legend)} rerouted={!!nav.reroute} />
        {nav.loading && <div className="pointer-events-none absolute right-4 top-4 z-[600] flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-soft"><Loader2 size={14} className="mr-1 animate-spin" />Computing routes</div>}
        {desktop && selected && onRoute.length > 0 && (
          <div className="absolute bottom-10 left-3 z-[600] max-w-xs rounded-3xl bg-white/95 p-3 shadow-float">
            <div className="flex items-center gap-2 text-xs font-bold text-[#C4444E]"><AlertTriangle size={14} />Hazards on the {selected.label}</div>
            {onRoute.map((h) => (
              <button key={h.id} className="mt-1 block text-left text-xs hover:underline" onClick={() => setHazardId(h.id)}>
                {h.category_label} · {h.location_label} <span className="text-muted">({h.certainty === "reported" ? "unverified" : h.certainty.replace("_", " ")})</span>
              </button>
            ))}
          </div>
        )}
      </>}>
      {hazards.data && <AffectedPathLines items={hazards.data} onSelect={(i) => setHazardId(i.id)} />}
      {nav.reroute && <GhostRoute route={nav.reroute.previous} />}
      {hazards.data && <HazardMarkers items={hazards.data} onSelect={(i) => setHazardId(i.id)} highlightIds={routeHazards} />}
      {nav.plan && <RouteLines plan={nav.plan} selected={nav.selected} onSelect={nav.setSelected} />}
      {!nav.plan && destination && <MapMarker position={[destination.lat, destination.lon]} icon={destIcon} />}
    </NavigationMap>
  );

  return (
    <>
      {desktop ? (
        <div className="flex h-[calc(100vh-64px)] gap-5 p-5">
          <aside ref={scroller} className="w-[440px] shrink-0 space-y-4 overflow-y-auto pb-6 scroll-thin">{panel}</aside>
          <div className="relative flex-1">{map}</div>
        </div>
      ) : (
        <div className="relative h-[calc(100dvh-64px)] overflow-hidden">
          <div className={clsx("absolute inset-x-0 top-0", nav.plan ? "bottom-[232px]" : "bottom-[180px]")}>{map}</div>
          {/* collapsible route sheet above the bottom navigation */}
          <section className={clsx("absolute inset-x-0 bottom-0 z-[700] flex flex-col rounded-t-4xl bg-canvas/95 shadow-float backdrop-blur transition-[height] duration-300",
            sheetOpen ? "h-[78%]" : nav.plan ? "h-[256px]" : "h-[204px]")}>
            <button className="flex w-full flex-col items-center gap-1 px-4 pb-2 pt-2.5" onClick={() => setSheetOpen(!sheetOpen)}
              aria-expanded={sheetOpen} aria-label={sheetOpen ? "Collapse route panel" : "Expand route panel"}>
              <span className="h-1.5 w-10 rounded-full bg-line" />
              <SheetSummary route={selected} open={sheetOpen} hazards={onRoute.length} />
            </button>
            {nav.plan && !sheetOpen && (
              <div className="flex gap-2 overflow-x-auto px-3 pb-2 scroll-thin" role="group" aria-label="Choose route">
                {nav.plan.routes.map((r) => {
                  const st = ROUTE_STYLE[r.preference];
                  const on = r.preference === nav.selected;
                  return (
                    <button key={r.preference} onClick={() => nav.setSelected(r.preference as typeof nav.selected)} aria-pressed={on}
                      className={clsx("flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold ring-1 transition", on ? "bg-white shadow-soft ring-2" : "bg-white/70 ring-line")}
                      style={on ? { ["--tw-ring-color" as string]: st.color } : undefined}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                      {st.label} · {fmtDuration(r.duration_s)}
                      {r.preference === nav.plan!.recommended && <Sparkles size={12} className="text-lavender-deep" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-28 scroll-thin">{panel}</div>
          </section>
        </div>
      )}

      <Modal open={alertOpen} onClose={() => { nav.keepCurrentRoute(); setParams({}); }} title={nav.alert?.notification.title}>
        {nav.alert && <AlertBody />}
      </Modal>
      <Drawer open={hazardId != null} onClose={() => setHazardId(null)}>
        {hazardId != null && <HazardDetailPanel id={hazardId} onClose={() => setHazardId(null)} />}
      </Drawer>
    </>
  );

  function SheetSummary({ route, open, hazards: n }: { route?: Route; open: boolean; hazards: number }) {
    if (!route) {
      return <span className="flex w-full items-center justify-between text-sm font-bold">Plan your trip {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</span>;
    }
    const st = ROUTE_STYLE[route.preference];
    return (
      <span className="flex w-full items-center gap-3 text-left">
        <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: st.color }} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{route.label}{route.preference === nav.plan?.recommended && <span className="ml-1.5 text-[11px] font-bold text-lavender-deep">· AI pick</span>}</span>
          <span className="block text-xs text-muted">{fmtDuration(route.duration_s)} · {fmtDistance(route.distance_m)} · {n > 0 ? `${n} hazard${n > 1 ? "s" : ""} on route` : "no hazards on route"}</span>
        </span>
        <SafetyScoreBadge score={route.safety.score} size="sm" />
        {open ? <ChevronDown size={18} className="text-muted" /> : <ChevronUp size={18} className="text-muted" />}
      </span>
    );
  }

  function SessionCard({ route }: { route: Route | null }) {
    const s = nav.session!;
    return (
      <div className="card overflow-hidden">
        <div className="bg-mint p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-mint-deep"><span className="h-2 w-2 animate-pulse rounded-full bg-success" />Navigation active · live alerts on</div>
          <div className="mt-1 text-lg font-extrabold">{s.destination.label ?? "Destination"}</div>
          {route
            ? <div className="text-sm text-ink/70">Arrive ≈ {fmtTime(route.arrival)} · {fmtDuration(route.duration_s)} · {route.label}</div>
            : <div className="text-sm text-ink/70">Following your {ROUTE_STYLE[s.preference].label} route. The map is showing a different option.</div>}
        </div>
        <div className="flex items-center justify-between gap-3 p-3">
          <span className="text-xs text-muted">You'll be alerted and offered a reroute if a hazard affects this route.</span>
          <button className="btn-danger shrink-0 !py-2" onClick={nav.endNavigation}><Square size={14} />End</button>
        </div>
      </div>
    );
  }

  function RerouteCard() {
    const r = nav.reroute!;
    const m = categoryMeta(r.incident.category);
    const delta = routeDelta(r.current, r.previous);
    return (
      <div className="card overflow-hidden animate-rise">
        <div className="flex items-start gap-3 bg-sky p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white"><RouteIcon size={18} className="text-sky-deep" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wide text-sky-deep">Rerouted</div>
            <div className="font-bold leading-snug">Avoiding {m.label.toLowerCase()} near {r.incident.location_label}</div>
          </div>
          <button className="btn-ghost h-8 w-8 shrink-0 !p-0" onClick={nav.clearReroute} aria-label="Dismiss reroute summary"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 p-4">
          <RouteColumn title="Previous" route={r.previous} muted warn />
          <span className="grid place-items-center text-muted"><ArrowRight size={18} /></span>
          <RouteColumn title="New" route={r.current} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-3 text-xs">
          {delta.length ? delta.map((d) => <span key={d.text} className={clsx("font-bold", d.good ? "text-mint-deep" : "text-[#C27A2C]")}>{d.text}</span>) : <span className="text-muted">Similar time and safety.</span>}
          <span className="ml-auto text-muted">Previous route: grey dotted line</span>
        </div>
      </div>
    );
  }

  function AlertBody() {
    const a = nav.alert!;
    const m = categoryMeta(a.incident.category);
    const delta = a.alternative && a.previous ? routeDelta(a.alternative, a.previous) : [];
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
        {a.alternative && a.previous && (
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-2 rounded-3xl bg-canvas p-3">
            <RouteColumn title="Your route" route={a.previous} muted warn />
            <span className="grid place-items-center text-muted"><ArrowRight size={18} /></span>
            <RouteColumn title="Alternative" route={a.alternative} />
          </div>
        )}
        {a.alternative && !a.previous && (
          <div className="mt-3 flex items-center gap-3 rounded-3xl bg-mint p-3">
            <ShieldCheck size={20} className="text-mint-deep" />
            <div className="flex-1 text-sm"><b>Alternative:</b> {fmtDuration(a.alternative.duration_s)} · avoids the reported hazard</div>
            <SafetyScoreBadge score={a.alternative.safety.score} size="sm" />
          </div>
        )}
        {delta.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 px-1 text-xs"><span className="text-muted">Alternative vs your route:</span>
            {delta.map((d) => <span key={d.text} className={clsx("font-bold", d.good ? "text-mint-deep" : "text-[#C27A2C]")}>{d.text}</span>)}</div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={async () => { await nav.keepCurrentRoute(); setParams({}); }}>Keep my route</button>
          <button className="btn-soft" onClick={() => { setHazardId(a.incident.id); }}>View hazard</button>
          {a.alternative && <button className="btn-primary" onClick={async () => { await nav.applyAlternative(); setParams({}); }}><Sparkles size={15} />Use alternative route</button>}
        </div>
      </div>
    );
  }
}

function RouteColumn({ title, route, muted, warn }: { title: string; route: Route; muted?: boolean; warn?: boolean }) {
  const st = ROUTE_STYLE[route.preference];
  return (
    <div className={clsx("rounded-2xl bg-white p-3 ring-1 ring-line", muted && "opacity-80")}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: muted ? "#9AA1AD" : st.color }} />{title}
      </div>
      <div className="mt-1 text-lg font-extrabold leading-tight">{fmtDuration(route.duration_s)}</div>
      <div className="text-xs text-muted">{fmtDistance(route.distance_m)} · safety {route.safety.score}</div>
      <div className={clsx("mt-1 text-xs font-semibold", route.hazard_ids.length || warn ? "text-[#C4444E]" : "text-mint-deep")}>
        {warn ? "Crosses the hazard" : route.hazard_ids.length ? `${route.hazard_ids.length} hazard${route.hazard_ids.length > 1 ? "s" : ""}` : "No hazards"}
      </div>
    </div>
  );
}

function MapLegend({ open, onToggle, rerouted }: { open: boolean; onToggle: () => void; rerouted: boolean }) {
  const row = (swatch: ReactNode, label: string) => <div className="flex items-center gap-2">{swatch}<span>{label}</span></div>;
  const line = (color: string, dash?: string) => (
    <svg width="28" height="8" className="shrink-0"><line x1="2" y1="4" x2="26" y2="4" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={dash} /></svg>
  );
  return (
    <div className="absolute left-3 top-3 z-[600]">
      <button onClick={onToggle} className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold shadow-soft" aria-expanded={open}>
        <Layers size={14} />Legend
      </button>
      {open && (
        <div className="mt-2 w-56 space-y-1.5 rounded-3xl bg-white/95 p-3 text-xs shadow-float animate-rise">
          {row(line(ROUTE_STYLE.fastest.color), "Fastest route")}
          {row(line(ROUTE_STYLE.safest.color), "Safest route")}
          {row(line(ROUTE_STYLE.balanced.color), "Smart Balance")}
          {row(line("#E2545E", "6 5"), "Confirmed closure (avoided)")}
          {row(line("#F09A4A"), "Verified hazard: caution")}
          {row(line("#F4B860"), "Unverified report: warning")}
          {row(line("#9AA1AD", "3 5"), "Walk to/from nearest path")}
          {rerouted && row(line("#7B8290", "1 6"), "Previous route")}
          <p className="pt-1 text-[10px] leading-snug text-muted">Route lines follow mapped roads and footpaths only.</p>
        </div>
      )}
    </div>
  );
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
            <div className="flex justify-between gap-2 text-xs"><span className="font-semibold">{f.label} <span className="font-normal text-muted">· weight {Math.round(f.weight * 100)}%</span></span>
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
