import clsx from "clsx";
import { Activity, AlarmClock, CalendarClock, Clock, Flame, Gauge, Navigation, Route as RouteIcon, Timer, TrafficCone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { LocationSelector } from "@/components/LocationSelector";
import { NavigationMap } from "@/components/map/MapBase";
import { RouteLine, RouteLines } from "@/components/map/layers";
import { MapMarker, MapPolyline, MarkerIcon } from "@/components/map/primitives";
import { RouteComparisonCard } from "@/components/RouteComparisonCard";
import { AIInsightCard, ErrorNote, PageHeader, Segmented, Skeleton, StatCard, SyntheticBadge } from "@/components/ui";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { api, ApiError } from "@/lib/api";
import { fmtDuration, fmtTime, toLocalInput } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CONGESTION } from "@/lib/meta";
import type { BestDeparture, LatLon, Preference, SegmentForecast, TrafficForecast, TrafficPrediction, Weather } from "@/lib/types";

interface Seg { id: string; name: string; geometry: [number, number][][] }
interface ModelInfo { metrics: { horizons: Record<string, { ml: Metric; baseline: Metric; latency_ms_per_row: number; test_rows: number }>; train_rows: number; train_days: number; test_days: number } | null }
interface Metric { mae_kmh: number; rmse_kmh: number; travel_time_mae_s: number; congestion_accuracy: number }

const DEF_O: LatLon = { lat: 2.92787, lon: 101.6422422, label: "Multimedia University" };
const DEF_D: LatLon = { lat: 2.9204475, lon: 101.631591, label: "Hospital Cyberjaya" };
const HORIZONS = [{ v: 0, l: "At departure" }, { v: 1, l: "+15 min" }, { v: 2, l: "+30 min" }, { v: 3, l: "+60 min" }];
const LEVEL_RANK: Record<string, number> = { low: 0, moderate: 1, high: 2, severe: 3 };
const tip = { borderRadius: 16, border: "none", boxShadow: "0 12px 32px -16px rgba(0,0,0,.25)" };
const mins = (s: number) => Math.round(s / 6) / 10;

const hotspotIcons = new Map<string, MarkerIcon>();
function hotspotIcon(n: number, color: string): MarkerIcon {
  const k = `${n}${color}`;
  if (!hotspotIcons.has(k)) {
    hotspotIcons.set(k, {
      html: `<div style="width:30px;height:30px;border-radius:999px;background:${color};border:3px solid #fff;box-shadow:0 6px 14px -6px rgba(32,33,36,.6);display:grid;place-items:center;color:#fff;font:800 13px/1 'Plus Jakarta Sans',sans-serif">${n}</div>`,
      size: [30, 30], anchor: [15, 15],
    });
  }
  return hotspotIcons.get(k)!;
}

export default function TrafficForecastPage() {
  const nav = useNav();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<LatLon | null>(DEF_O);
  const [dest, setDest] = useState<LatLon | null>(DEF_D);
  /** null = leave now; otherwise an ISO time (a timeline slot or a custom time) */
  const [departIso, setDepartIso] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [weather, setWeather] = useState<Weather>("auto");
  const [horizon, setHorizon] = useState(0);
  const [pred, setPred] = useState<TrafficPrediction | null>(null);
  const [predErr, setPredErr] = useState<string | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [selected, setSelected] = useState<Preference>("fastest");
  const [arriveBy, setArriveBy] = useState(toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [best, setBest] = useState<BestDeparture | null>(null);
  const [bestErr, setBestErr] = useState<string | null>(null);
  const [bestLoading, setBestLoading] = useState(false);

  const fq = `/api/traffic/forecast?weather=${weather}${departIso ? `&depart_at=${encodeURIComponent(departIso)}` : ""}`;
  const forecast = useApi<TrafficForecast>(fq);
  const segs = useApi<Seg[]>("/api/traffic/segments");
  const model = useApi<ModelInfo>("/api/traffic/model");

  const runPredict = useCallback(async () => {
    if (!origin || !dest) return;
    setPredLoading(true); setPredErr(null);
    try {
      const p = await api<TrafficPrediction>("/api/traffic/predict", { body: { origin, destination: dest, weather, depart_at: departIso } });
      setPred(p);
      setSelected("fastest");
    } catch (e) { setPredErr(e instanceof ApiError ? e.message : "Prediction failed"); setPred(null); }
    finally { setPredLoading(false); }
  }, [origin, dest, weather, departIso]);
  useEffect(() => { runPredict(); }, [runPredict]);
  useRealtimeEvent(["hazard.", "demo.reset"], () => { forecast.reload(true); runPredict(); });

  const runBest = async () => {
    if (!origin || !dest) return;
    setBestLoading(true); setBestErr(null);
    try {
      setBest(await api<BestDeparture>("/api/traffic/best-departure", { body: { origin, destination: dest, weather, arrive_by: arriveBy ? new Date(arriveBy).toISOString() : null } }));
    } catch (e) { setBestErr(e instanceof ApiError ? e.message : "Could not compute departure times"); }
    finally { setBestLoading(false); }
  };

  const openInNavigation = () => {
    if (!origin || !dest) return;
    nav.setMode("drive");
    nav.setOrigin(origin);
    nav.setDestination(dest);
    nav.setWeather(weather);
    nav.setDepartAt(departIso ? toLocalInput(new Date(departIso)) : null);
    nav.setSelected(selected);
    navigate("/navigate");
  };

  const f = forecast.data;
  const timeline = pred?.timeline ?? [];
  const chosenIdx = departIso ? timeline.findIndex((t) => Math.abs(new Date(t.depart).getTime() - new Date(departIso).getTime()) < 60_000) : 0;
  const chartData = timeline.map((t, i) => ({
    i, t: i === 0 ? "Now" : fmtTime(t.depart), fastest: mins(t.duration_s), usual: t.usual_s != null ? mins(t.usual_s) : null, free: mins(t.free_flow_s),
  }));
  const bestSlot = timeline.length ? timeline.reduce((a, t) => (t.duration_s < a.duration_s ? t : a)) : null;
  const outlook = f?.outlook.map((o) => ({ t: fmtTime(o.time), load: Math.round((1 - o.avg_ratio) * 100) })) ?? [];
  const fastest = pred?.routes.find((r) => r.preference === "fastest");
  const safest = pred?.routes.find((r) => r.preference === "safest");
  const usual = pred?.usual ?? null;
  const routeSaving = usual && fastest ? usual.duration_s - fastest.duration_s : 0;
  const departSaving = fastest && bestSlot ? fastest.duration_s - bestSlot.duration_s : 0;
  const recommendFastest = routeSaving >= 60 && usual && fastest && usual.edge_ids.join() !== fastest.edge_ids.join();

  // top congestion hotspots at the selected horizon (forecast model outputs only)
  const hotspots = useMemo(() => {
    if (!f) return [];
    return f.segments
      .map((s) => ({ s, fc: s.forecasts[horizon] as SegmentForecast }))
      .filter((x) => x.fc && LEVEL_RANK[x.fc.level] >= 1)
      .sort((a, b) => a.fc.ratio - b.fc.ratio)
      .slice(0, 5);
  }, [f, horizon]);
  const geomById = useMemo(() => Object.fromEntries((segs.data ?? []).map((s) => [s.id, s.geometry])), [segs.data]);
  const levelBySeg = useMemo(() => Object.fromEntries((f?.segments ?? []).map((s) => [s.id, s.forecasts[horizon]])), [f, horizon]);
  const departLabel = departIso ? fmtTime(departIso) : "now";
  const horizonTime = f?.segments[0]?.forecasts[horizon]?.target_time;

  return (
    <div className="page">
      <PageHeader title="Traffic AI Forecast" eyebrow={<SyntheticBadge label={`Synthetic demo data · model ${f?.model_version ?? "rf-v1"}`} note={f?.data_source.note} />}
        subtitle="Congestion forecasts for Cyberjaya's main corridors, journey-time predictions by departure time, and the best time to leave." />

      {/* trip + departure */}
      <div className="card card-pad mb-6 space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_220px]">
          <div><span className="label">From</span><div className="mt-1"><LocationSelector value={origin} onChange={setOrigin} placeholder="Origin" dot="#3FAE97" /></div></div>
          <div><span className="label">To</span><div className="mt-1"><LocationSelector value={dest} onChange={setDest} placeholder="Destination" dot="#7968C9" /></div></div>
          <div>
            <span className="label">Weather input</span>
            <select className="input mt-1 !py-2.5" value={weather} onChange={(e) => setWeather(e.target.value as Weather)}>
              <option value="auto">Synthetic weather feed</option><option value="clear">Scenario: clear</option><option value="rain">Scenario: rain</option>
            </select>
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <span className="label">Departure time · forecast door-to-door drive (fastest route)</span>
            <button className="text-xs font-semibold text-lavender-deep" onClick={() => setCustom(!custom)}>{custom ? "Use time slots" : "Custom time"}</button>
          </div>
          {custom ? (
            <input type="datetime-local" className="input mt-2 !w-auto !py-2" min={toLocalInput(new Date())}
              value={departIso ? toLocalInput(new Date(departIso)) : ""} onChange={(e) => setDepartIso(e.target.value ? new Date(e.target.value).toISOString() : null)} />
          ) : (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 scroll-thin" role="group" aria-label="Departure time">
              {timeline.length === 0 && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[58px] w-[86px] shrink-0" />)}
              {timeline.map((t, i) => {
                const on = i === (chosenIdx < 0 ? -1 : chosenIdx);
                const delay = t.duration_s - t.free_flow_s;
                const lvl = delay >= 240 ? "severe" : delay >= 120 ? "high" : delay >= 45 ? "moderate" : "low";
                return (
                  <button key={t.depart} aria-pressed={on} onClick={() => setDepartIso(i === 0 ? null : t.depart)}
                    className={clsx("flex w-[86px] shrink-0 flex-col items-start rounded-2xl px-3 py-2 text-left ring-1 transition",
                      on ? "bg-lavender-deep text-white ring-lavender-deep shadow-soft" : "bg-canvas ring-line hover:bg-white")}>
                    <span className={clsx("text-xs font-semibold", on ? "text-white/80" : "text-muted")}>{i === 0 ? "Now" : fmtTime(t.depart)}</span>
                    <span className="flex items-center gap-1.5 text-sm font-extrabold">
                      <span className="h-2 w-2 rounded-full" style={{ background: CONGESTION[lvl].color }} />{Math.round(t.duration_s / 60)} min
                    </span>
                    {bestSlot && t.depart === bestSlot.depart && <span className={clsx("text-[10px] font-bold", on ? "text-white" : "text-mint-deep")}>Quickest</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* city overview */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="City-wide traffic" value={<span className="capitalize">{f?.summary.current_level ?? "–"}</span>} icon={Activity} tone="mint" hint={`at ${departLabel}, length weighted`} />
        <StatCard label="Predicted peak" value={f ? fmtTime(f.summary.predicted_peak.time) : "–"} icon={AlarmClock} tone="peach" hint={f ? `${f.summary.predicted_peak.level} congestion · next 8 h` : undefined} />
        <StatCard label="Avg delay per corridor" value={f ? `${Math.round(f.summary.avg_forecast_delay_s)} s` : "–"} icon={Timer} tone="lavender" hint="30 min after departure" />
        <StatCard label="Congested corridors" value={f ? `${f.summary.congested_segments_30} of ${f.summary.segments_total}` : "–"} icon={TrafficCone} tone="rose" hint="high or severe, 30 min after departure" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        {/* heatmap + hotspots */}
        <section className="card card-pad">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Congestion heatmap</h2>
              <p className="text-sm text-muted">Forecast per corridor{horizonTime ? ` at ${fmtTime(horizonTime)}` : ""} · numbered hotspots · your route on top</p>
            </div>
            <Segmented value={String(horizon)} onChange={(v) => setHorizon(Number(v))} options={HORIZONS.map((h) => ({ value: String(h.v), label: h.l }))} />
          </div>
          <NavigationMap className="h-[380px] sm:h-[440px]" fitTo={fastest?.geometry ?? null} fitKey={`${fastest?.distance_m}`}>
            {segs.data?.map((s) => {
              const fc = levelBySeg[s.id];
              if (!fc) return null;
              return s.geometry.map((g, i) => (
                <MapPolyline key={`${s.id}${i}`} positions={g} color={CONGESTION[fc.level].color} weight={5} opacity={0.85}
                  tooltip={`${s.name}: ${CONGESTION[fc.level].label} · ${fc.speed_kmh} km/h (${fc.method === "observed" ? "synthetic observation" : "forecast"})`} />
              ));
            })}
            {usual && <RouteLine route={usual} active={false} />}
            {pred && <RouteLines plan={pred} selected={selected} onSelect={setSelected} showCongestion={false} />}
            {hotspots.map((h, i) => {
              const g = geomById[h.s.id]?.[0];
              if (!g) return null;
              return <MapMarker key={h.s.id} position={g[Math.floor(g.length / 2)]} icon={hotspotIcon(i + 1, CONGESTION[h.fc.level].color)} zIndex={900}
                tooltip={`Hotspot ${i + 1}: ${h.s.name} · ${CONGESTION[h.fc.level].label} · ${h.fc.speed_kmh} km/h`} />;
            })}
          </NavigationMap>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            {Object.entries(CONGESTION).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full" style={{ background: v.color }} />{v.label}</span>)}
            <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-[#9AA1AD]" />Usual route</span>
            <span className="sm:ml-auto">Minor roads use a time-of-day profile and are not shown.</span>
          </div>
          <div className="mt-4">
            <h3 className="flex items-center gap-1.5 text-sm font-bold"><Flame size={15} className="text-[#E2545E]" />Congestion hotspots{horizonTime ? ` · ${fmtTime(horizonTime)}` : ""}</h3>
            {hotspots.length === 0 ? <p className="mt-1 text-sm text-muted">No corridor is forecast above low congestion at this time.</p> : (
              <ol className="mt-2 grid gap-2 sm:grid-cols-2">
                {hotspots.map((h, i) => (
                  <li key={h.s.id} className="flex items-center gap-3 rounded-2xl bg-canvas px-3 py-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold text-white" style={{ background: CONGESTION[h.fc.level].color }}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-snug">{h.s.name}</span>
                      <span className="block text-xs text-muted">{CONGESTION[h.fc.level].label} · {h.fc.speed_kmh} km/h · +{Math.round(h.fc.delay_s)} s{h.s.incident ? " · incident reported" : ""}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <div className="space-y-6">
          {predErr && <ErrorNote message={predErr} onRetry={runPredict} />}
          <AIInsightCard title={`AI recommendation · leaving ${departLabel}`} footer={pred && (
            <button className="btn-primary !py-2" onClick={openInNavigation}><Navigation size={15} />Open {selected === "fastest" ? "fastest" : selected} route in navigation</button>
          )}>
            {predLoading && !pred ? <Skeleton className="h-16 bg-white/60" /> : pred && (
              <>
                <p className="text-base font-bold leading-snug">
                  {recommendFastest
                    ? `Take the forecast-fastest route${fastest!.via.length ? ` via ${fastest!.via.slice(0, 2).join(", ")}` : ""}.`
                    : "Your usual route is as quick as any alternative at this time."}
                </p>
                <ul className="space-y-1.5">
                  {pred.insights.map((i, k) => <li key={k} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lavender-deep" />{i.text}</li>)}
                  {fastest && <li className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lavender-deep" />Route model: {fastest.explanation}</li>}
                </ul>
              </>
            )}
            <p className="text-xs text-muted">Based only on the traffic model's forecasts for this trip (synthetic training data), not live traffic.</p>
          </AIInsightCard>

          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-lg font-bold"><Timer size={18} />Estimated time savings</h2>
            {!pred ? <Skeleton className="mt-3 h-24" /> : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-mint p-3">
                  <div className="text-xs font-semibold text-mint-deep">By route choice</div>
                  <div className="mt-1 text-2xl font-extrabold">{routeSaving >= 30 ? fmtDuration(routeSaving) : "—"}</div>
                  <div className="text-xs leading-snug text-muted">{routeSaving >= 30 ? `fastest vs usual route, leaving ${departLabel}` : "fastest ≈ usual route"}</div>
                </div>
                <div className="rounded-2xl bg-lavender-soft p-3">
                  <div className="text-xs font-semibold text-lavender-deep">By departure time</div>
                  <div className="mt-1 text-2xl font-extrabold">{departSaving >= 60 && bestSlot ? fmtDuration(departSaving) : "—"}</div>
                  <div className="text-xs leading-snug text-muted">{departSaving >= 60 && bestSlot ? `leave at ${fmtTime(bestSlot.depart)} instead of ${departLabel}` : "no quicker slot in the next 3 h"}</div>
                </div>
              </div>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="mb-3 text-lg font-bold">Route comparison</h2>
            {!pred ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : (
              <div className="space-y-2.5">
                {usual && (
                  <div className="pointer-events-none opacity-90">
                    <RouteComparisonCard compact route={usual} selected={false} onSelect={() => {}} />
                  </div>
                )}
                {fastest && <RouteComparisonCard compact route={fastest} selected={selected === "fastest"} onSelect={() => setSelected("fastest")}
                  recommended={!!recommendFastest} compareTo={usual} compareLabel="usual" />}
                {safest && !safest.same_as && <RouteComparisonCard compact route={safest} selected={selected === "safest"} onSelect={() => setSelected("safest")}
                  compareTo={usual} compareLabel="usual" />}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="flex items-center gap-2 text-lg font-bold"><RouteIcon size={18} />Journey time by departure</h2>
          <p className="mb-3 text-sm text-muted">Usual route vs forecast-fastest route, next 3 hours (driving). Tap a point to pick that departure.</p>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ left: -14, right: 8, top: 8 }}
                onClick={(e) => { const i = e?.activeTooltipIndex; if (i != null && timeline[i]) setDepartIso(i === 0 ? null : timeline[i].depart); }}>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} interval={1} />
                <YAxis tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} domain={[0, "dataMax + 2"]} allowDecimals={false} tickFormatter={(v: number) => `${Math.round(v)}m`} />
                <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [`${v} min`, n === "fastest" ? "Fastest route" : n === "usual" ? "Usual route" : "Free-flow"]} />
                <Legend formatter={(v: string) => (v === "fastest" ? "Fastest route" : v === "usual" ? "Usual route" : "Free-flow")} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                {chosenIdx >= 0 && chartData[chosenIdx] && <ReferenceLine x={chartData[chosenIdx].t} stroke="#7968C9" strokeDasharray="4 4" label={{ value: "Your departure", position: "insideTopRight", fontSize: 11, fill: "#7968C9" }} />}
                <Line isAnimationActive={false} type="monotone" dataKey="free" stroke="#C9CEDA" strokeDasharray="5 5" dot={false} strokeWidth={2} />
                <Line isAnimationActive={false} type="monotone" dataKey="usual" stroke="#9AA1AD" strokeWidth={2.5} dot={{ r: 2.5, fill: "#9AA1AD" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="fastest" stroke="#7968C9" strokeWidth={3} dot={{ r: 3, fill: "#7968C9" }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="text-lg font-bold">City congestion outlook</h2>
          <p className="mb-3 text-sm text-muted">Average load across all corridors, next 8 hours (higher = slower)</p>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={outlook} margin={{ left: -14, right: 8, top: 8 }}>
                <defs><linearGradient id="ol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4B860" stopOpacity={0.6} /><stop offset="1" stopColor="#F4B860" stopOpacity={0.05} /></linearGradient></defs>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} interval={3} />
                <YAxis tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={tip} formatter={(v: number) => [`${v}% below free-flow speed`, "Average load"]} />
                <Area type="monotone" dataKey="load" stroke="#E9A23F" strokeWidth={2.5} fill="url(#ol)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* best time to leave */}
      <section className="card card-pad mt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarClock size={19} />Best time to leave</h2>
            <p className="text-sm text-muted">Compares 15-minute departure windows using forecast travel times on {origin?.label ?? "origin"} → {dest?.label ?? "destination"}.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label><span className="label">Arrive by</span><input type="datetime-local" className="input mt-1 !w-auto !py-2" value={arriveBy} min={toLocalInput(new Date())} onChange={(e) => setArriveBy(e.target.value)} /></label>
            <button className="btn-primary" onClick={runBest} disabled={bestLoading || !origin || !dest}><Clock size={15} />{bestLoading ? "Comparing…" : "Find best departure"}</button>
          </div>
        </div>
        {bestErr && <div className="mt-4"><ErrorNote message={bestErr} /></div>}
        {best && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <AIInsightCard title="Recommendation" tone="mint" footer={best.verdict === "ok" && (
              <button className="btn-primary !py-2" onClick={() => { setCustom(false); setDepartIso(best.recommended.depart); }}>Use {fmtTime(best.recommended.depart)} departure</button>
            )}>
              <p className="text-2xl font-extrabold">Leave at {fmtTime(best.recommended.depart)}</p>
              <p>Arrive ≈ {fmtTime(best.recommended.arrival)} · journey {fmtDuration(best.recommended.duration_s)}</p>
              <p>{best.insight}</p>
            </AIInsightCard>
            <div>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={best.options.map((o) => ({ t: fmtTime(o.depart), min: mins(o.duration_s) }))} margin={{ left: -14, right: 8 }}>
                    <CartesianGrid stroke="#EEF0F4" vertical={false} />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} unit="m" />
                    <Tooltip contentStyle={tip} formatter={(v: number) => [`${v} min`, "Journey"]} />
                    <Bar dataKey="min" radius={[10, 10, 4, 4]}>
                      {best.options.map((o, i) => <Cell key={i} fill={o.depart === best.recommended.depart ? "#58B99B" : o.on_time ? "#C9C0F2" : "#F5C2C6"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#58B99B]" />Recommended</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#C9C0F2]" />Arrives on time</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#F5C2C6]" />Arrives late</span>
              </p>
            </div>
          </div>
        )}
      </section>

      {/* model evaluation */}
      <section className="card card-pad mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><Gauge size={19} />Model evaluation</h2>
            <p className="text-sm text-muted">RandomForest vs historical-average baseline on a held-out synthetic week.</p>
          </div>
          <SyntheticBadge label="Evaluated on synthetic data" />
        </div>
        {model.data?.metrics && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-muted">
                <th className="py-2 font-semibold">Horizon</th><th className="font-semibold">Model</th><th className="font-semibold">MAE (km/h)</th>
                <th className="font-semibold">RMSE (km/h)</th><th className="font-semibold">Travel-time MAE</th><th className="font-semibold">Congestion accuracy</th><th className="font-semibold">Latency / row</th>
              </tr></thead>
              <tbody>
                {Object.entries(model.data.metrics.horizons).map(([h, m]) => (["ml", "baseline"] as const).map((k) => (
                  <tr key={h + k} className={clsx("border-t border-line", k === "ml" && "font-semibold")}>
                    <td className="py-2">{k === "ml" ? `+${h} min` : ""}</td>
                    <td>{k === "ml" ? <span className="chip bg-lavender text-lavender-deep">Random Forest</span> : <span className="chip bg-canvas text-muted">Baseline</span>}</td>
                    <td>{m[k].mae_kmh}</td><td>{m[k].rmse_kmh}</td><td>{m[k].travel_time_mae_s} s</td><td>{Math.round(m[k].congestion_accuracy * 1000) / 10}%</td>
                    <td>{k === "ml" ? `${m.latency_ms_per_row} ms` : "—"}</td>
                  </tr>
                )))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Trained on {model.data.metrics.train_rows.toLocaleString()} rows ({model.data.metrics.train_days} days), tested on {model.data.metrics.test_days} days. Weather and incident flags at the target time are model inputs (assumes a weather forecast is available).</p>
          </div>
        )}
      </section>
    </div>
  );
}
