import clsx from "clsx";
import { Activity, AlarmClock, CalendarClock, Clock, Gauge, Navigation, Timer, TrafficCone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Polyline, Tooltip as LTooltip } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { LocationSelector } from "@/components/LocationSelector";
import { NavigationMap } from "@/components/map/MapBase";
import { RouteLine, RouteLines } from "@/components/map/layers";
import { RouteComparisonCard } from "@/components/RouteComparisonCard";
import { AIInsightCard, ErrorNote, PageHeader, Segmented, Skeleton, StatCard, SyntheticBadge } from "@/components/ui";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { api, ApiError } from "@/lib/api";
import { fmtDuration, fmtTime, toLocalInput } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CONGESTION } from "@/lib/meta";
import type { BestDeparture, LatLon, Preference, TrafficForecast, TrafficPrediction, Weather } from "@/lib/types";

interface Seg { id: string; name: string; geometry: [number, number][][] }
interface ModelInfo { metrics: { horizons: Record<string, { ml: Metric; baseline: Metric; latency_ms_per_row: number; test_rows: number }>; train_rows: number; train_days: number; test_days: number } | null }
interface Metric { mae_kmh: number; rmse_kmh: number; travel_time_mae_s: number; congestion_accuracy: number }

const DEF_O: LatLon = { lat: 2.92787, lon: 101.6422422, label: "Multimedia University" };
const DEF_D: LatLon = { lat: 2.9204475, lon: 101.631591, label: "Hospital Cyberjaya" };
const HORIZONS = [{ v: 0, l: "Now" }, { v: 1, l: "+15 min" }, { v: 2, l: "+30 min" }, { v: 3, l: "+60 min" }];

export default function TrafficForecastPage() {
  const nav = useNav();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<LatLon | null>(DEF_O);
  const [dest, setDest] = useState<LatLon | null>(DEF_D);
  const [departMode, setDepartMode] = useState<"now" | "later">("now");
  const [departAt, setDepartAt] = useState(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [weather, setWeather] = useState<Weather>("auto");
  const [horizon, setHorizon] = useState(2);
  const [pred, setPred] = useState<TrafficPrediction | null>(null);
  const [predErr, setPredErr] = useState<string | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [selected, setSelected] = useState<Preference>("fastest");
  const [arriveBy, setArriveBy] = useState(toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [best, setBest] = useState<BestDeparture | null>(null);
  const [bestErr, setBestErr] = useState<string | null>(null);
  const [bestLoading, setBestLoading] = useState(false);

  const departIso = departMode === "later" && departAt ? new Date(departAt).toISOString() : null;
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

  const applyDeparture = (iso: string) => {
    setDepartMode("later");
    setDepartAt(toLocalInput(new Date(iso)));
  };

  const openInNavigation = () => {
    if (!origin || !dest) return;
    nav.setMode("drive");
    nav.setOrigin(origin);
    nav.setDestination(dest);
    nav.setWeather(weather);
    nav.setDepartAt(departMode === "later" ? departAt : null);
    nav.setSelected(selected);
    navigate("/navigate");
  };

  const f = forecast.data;
  const levelBySeg = useMemo(() => Object.fromEntries((f?.segments ?? []).map((s) => [s.id, s.forecasts[horizon]])), [f, horizon]);
  const timeline = pred?.timeline.map((t) => ({ t: fmtTime(t.depart), duration: Math.round(t.duration_s / 60 * 10) / 10, free: Math.round(t.free_flow_s / 60 * 10) / 10 })) ?? [];
  const outlook = f?.outlook.map((o) => ({ t: fmtTime(o.time), load: Math.round((1 - o.avg_ratio) * 100), congested: o.congested_segments })) ?? [];
  const fastest = pred?.routes.find((r) => r.preference === "fastest");
  const safest = pred?.routes.find((r) => r.preference === "safest");
  const saved = pred?.usual && fastest ? pred.usual.duration_s - fastest.duration_s : 0;

  return (
    <div className="page">
      <PageHeader title="Traffic AI Forecast" eyebrow={<SyntheticBadge label={`Synthetic demo data · model ${f?.model_version ?? "rf-v1"}`} note={f?.data_source.note} />}
        subtitle="Congestion forecasts for Cyberjaya's main corridors, journey-time predictions and the best time to leave." />

      {/* inputs */}
      <div className="card card-pad mb-6 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
        <div><span className="label">From</span><div className="mt-1"><LocationSelector value={origin} onChange={setOrigin} placeholder="Origin" dot="#3FAE97" /></div></div>
        <div><span className="label">To</span><div className="mt-1"><LocationSelector value={dest} onChange={setDest} placeholder="Destination" dot="#7968C9" /></div></div>
        <div>
          <span className="label">Departure</span>
          <div className="mt-1 flex gap-2">
            <Segmented value={departMode} onChange={setDepartMode} options={[{ value: "now", label: "Now" }, { value: "later", label: "Later" }]} />
            {departMode === "later" && <input type="datetime-local" className="input !w-auto !py-2" value={departAt} min={toLocalInput(new Date())} onChange={(e) => setDepartAt(e.target.value)} />}
          </div>
        </div>
        <div>
          <span className="label">Weather input</span>
          <select className="input mt-1 !py-2.5" value={weather} onChange={(e) => setWeather(e.target.value as Weather)}>
            <option value="auto">Synthetic weather feed</option><option value="clear">Scenario: clear</option><option value="rain">Scenario: rain</option>
          </select>
        </div>
      </div>

      {/* overview */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Current status" value={<span className="capitalize">{f?.summary.current_level ?? "–"}</span>} icon={Activity} tone="mint" hint="city-wide, length weighted" />
        <StatCard label="Predicted peak" value={f ? fmtTime(f.summary.predicted_peak.time) : "–"} icon={AlarmClock} tone="peach" hint={f ? `${f.summary.predicted_peak.level} · next 8 h` : undefined} />
        <StatCard label="Avg delay / corridor" value={f ? `${Math.round(f.summary.avg_forecast_delay_s)} s` : "–"} icon={Timer} tone="lavender" hint="at +30 min" />
        <StatCard label="Congested corridors" value={f ? `${f.summary.congested_segments_30}/${f.summary.segments_total}` : "–"} icon={TrafficCone} tone="rose" hint="high/severe at +30 min" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        {/* heatmap + route */}
        <section className="card card-pad">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Congestion heatmap</h2>
              <p className="text-sm text-muted">Forecast level per corridor{pred ? " · your predicted route on top" : ""}</p>
            </div>
            <Segmented value={String(horizon)} onChange={(v) => setHorizon(Number(v))} options={HORIZONS.map((h) => ({ value: String(h.v), label: h.l }))} />
          </div>
          <NavigationMap className="h-[420px]" fitTo={fastest?.geometry ?? null} fitKey={`${fastest?.distance_m}`}>
            {segs.data?.map((s) => {
              const fc = levelBySeg[s.id];
              if (!fc) return null;
              return s.geometry.map((g, i) => (
                <Polyline key={`${s.id}${i}`} positions={g} pathOptions={{ color: CONGESTION[fc.level].color, weight: 5, opacity: 0.85 }}>
                  <LTooltip sticky>{s.name}: {CONGESTION[fc.level].label} · {fc.speed_kmh} km/h ({fc.method === "observed" ? "synthetic observation" : "forecast"})</LTooltip>
                </Polyline>
              ));
            })}
            {pred?.usual && <RouteLine route={pred.usual} active={false} />}
            {pred && <RouteLines plan={pred} selected={selected} onSelect={setSelected} showCongestion={false} />}
          </NavigationMap>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            {Object.entries(CONGESTION).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full" style={{ background: v.color }} />{v.label}</span>)}
            <span className="ml-auto">Minor roads use a time-of-day profile and are not shown.</span>
          </div>
        </section>

        <div className="space-y-6">
          {predErr && <ErrorNote message={predErr} onRetry={runPredict} />}
          <AIInsightCard title="AI Insight" footer={pred && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary !py-2" onClick={openInNavigation}><Navigation size={15} />Open {selected} route in navigation</button>
            </div>
          )}>
            {predLoading && !pred ? <Skeleton className="h-16 bg-white/60" /> : pred?.insights.map((i, k) => <p key={k}>{i.text}</p>)}
            <p className="text-xs text-muted">Generated only from forecast outputs for this trip. Synthetic data.</p>
          </AIInsightCard>

          <section className="card card-pad">
            <h2 className="mb-3 text-lg font-bold">Route comparison</h2>
            {!pred ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : (
              <div className="space-y-2.5">
                {pred.usual && <RouteComparisonCard compact route={pred.usual} selected={false} onSelect={() => {}} />}
                {fastest && <RouteComparisonCard compact route={fastest} selected={selected === "fastest"} onSelect={() => setSelected("fastest")}
                  recommended={saved >= 60} />}
                {safest && !safest.same_as && <RouteComparisonCard compact route={safest} selected={selected === "safest"} onSelect={() => setSelected("safest")} />}
                <div className="flex items-center justify-between rounded-2xl bg-mint px-4 py-3 text-sm">
                  <span className="font-semibold text-mint-deep">Estimated time saved vs usual route</span>
                  <span className="font-extrabold">{saved >= 30 ? fmtDuration(saved) : "—"}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="text-lg font-bold">Journey time forecast</h2>
          <p className="mb-3 text-sm text-muted">Predicted fastest door-to-door time by departure (driving)</p>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={timeline} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} domain={[0, "dataMax + 2"]} allowDecimals={false} tickFormatter={(v: number) => `${Math.round(v)}m`} />
                <Tooltip contentStyle={{ borderRadius: 16, border: "none", boxShadow: "0 12px 32px -16px rgba(0,0,0,.25)" }} formatter={(v: number, n) => [`${v} min`, n === "duration" ? "Forecast" : "Free-flow"]} />
                <Line type="monotone" dataKey="free" stroke="#C9CEDA" strokeDasharray="5 5" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="duration" stroke="#7968C9" strokeWidth={3} dot={{ r: 3, fill: "#7968C9" }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="text-lg font-bold">City congestion outlook</h2>
          <p className="mb-3 text-sm text-muted">Average load across all corridors, next 8 hours (higher = slower)</p>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={outlook} margin={{ left: -18, right: 8, top: 8 }}>
                <defs><linearGradient id="ol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4B860" stopOpacity={0.6} /><stop offset="1" stopColor="#F4B860" stopOpacity={0.05} /></linearGradient></defs>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} interval={1} />
                <YAxis tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 16, border: "none" }} formatter={(v: number, n) => [n === "load" ? `${v}% below free-flow` : v, n === "load" ? "Load" : "Congested corridors"]} />
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
            <p className="text-sm text-muted">Compares departure windows using forecast travel times on {origin?.label ?? "origin"} → {dest?.label ?? "destination"}.</p>
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
              <button className="btn-primary !py-2" onClick={() => applyDeparture(best.recommended.depart)}>Use {fmtTime(best.recommended.depart)} departure</button>
            )}>
              <p className="text-2xl font-extrabold">Leave at {fmtTime(best.recommended.depart)}</p>
              <p>{best.insight}</p>
            </AIInsightCard>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={best.options.map((o) => ({ t: fmtTime(o.depart), min: Math.round(o.duration_s / 6) / 10, on: o.on_time, rec: o.depart === best.recommended.depart }))} margin={{ left: -18, right: 8 }}>
                  <CartesianGrid stroke="#EEF0F4" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} unit="m" />
                  <Tooltip contentStyle={{ borderRadius: 16, border: "none" }} formatter={(v: number) => [`${v} min`, "Journey"]} />
                  <Bar dataKey="min" radius={[10, 10, 4, 4]}>
                    {best.options.map((o, i) => <Cell key={i} fill={o.depart === best.recommended.depart ? "#58B99B" : o.on_time ? "#C9C0F2" : "#F5C2C6"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 text-xs text-muted">Green = recommended · lavender = arrives on time · pink = arrives late</p>
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
