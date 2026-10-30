import { Activity, ArrowRight, Camera, CheckCircle2, ChevronRight, Clock3, FileText, Navigation, ShieldAlert, TrafficCone } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardReportCard } from "@/components/HazardReportCard";
import { CityIllustration } from "@/components/Illustrations";
import { LocationSelector } from "@/components/LocationSelector";
import { NavigationMap } from "@/components/map/MapBase";
import { AffectedPathLines, HazardMarkers } from "@/components/map/layers";
import { Drawer, EmptyState, LoadingSkeleton, SectionHeader, StatCard, SyntheticBadge } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { fmtDuration, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CONGESTION } from "@/lib/meta";
import type { Incident, TrafficForecast } from "@/lib/types";

interface Summary { total: number; active: number; pending: number; resolved: number; my_reports: number; recent: Incident[] }

export default function Overview() {
  const { user } = useAuth();
  const nav = useNav();
  const navigate = useNavigate();
  const summary = useApi<Summary>("/api/dashboard/summary");
  const active = useApi<Incident[]>("/api/hazards?state=active&paths=true");
  const traffic = useApi<TrafficForecast>("/api/traffic/forecast");
  const [open, setOpen] = useState<number | null>(null);
  useRealtimeEvent(["hazard.", "demo.reset"], () => { summary.reload(true); active.reload(true); });

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const s = summary.data;
  const t = traffic.data?.summary;
  const closures = active.data?.filter((i) => i.restriction === "closed").length ?? 0;
  const outlook = traffic.data?.outlook.slice(0, 13).map((o) => ({ t: fmtTime(o.time), load: Math.round((1 - o.avg_ratio) * 100) })) ?? [];
  const navRoute = nav.session && nav.plan?.routes.find((r) => r.edge_ids.join() === nav.session!.edge_ids.join());

  return (
    <div className="page">
      <section className="relative mb-6 overflow-hidden rounded-4xl bg-gradient-to-br from-lavender via-[#F3F0FF] to-sky p-6 shadow-soft sm:p-8">
        <div className="grid items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="relative z-10">
            <p className="text-sm font-semibold text-lavender-deep">{greet}, {user?.name.split(" ")[0]} 👋</p>
            <h1 className="mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">Where are you heading in Cyberjaya?</h1>
            <div className="mt-5 max-w-lg rounded-3xl bg-white/80 p-2 shadow-soft backdrop-blur">
              <LocationSelector value={null} dot="#7968C9" placeholder="Search a destination in Cyberjaya"
                onChange={(p) => { if (p) { nav.setDestination(p); navigate("/navigate"); } }} />
            </div>
            {/* the two primary actions */}
            <div className="mt-4 grid max-w-lg grid-cols-2 gap-3">
              <Link to="/navigate" className="flex flex-col gap-2 rounded-3xl bg-lavender-deep p-4 text-white shadow-[0_14px_30px_-14px_rgba(121,104,201,.9)] transition hover:-translate-y-0.5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/20"><Navigation size={20} /></span>
                <span className="text-base font-extrabold leading-tight">Plan a trip</span>
                <span className="text-xs leading-snug text-white/80">Fastest, safest & AI-balanced routes</span>
              </Link>
              <Link to="/report" className="flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-soft ring-1 ring-line transition hover:-translate-y-0.5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#FDE4E6] text-[#C4444E]"><Camera size={20} /></span>
                <span className="text-base font-extrabold leading-tight">Report a hazard</span>
                <span className="text-xs leading-snug text-muted">Photo + pin · alerts people on that path</span>
              </Link>
            </div>
            <Link to="/traffic" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-lavender-deep">
              <TrafficCone size={15} />Check Traffic AI & best time to leave<ChevronRight size={15} />
            </Link>
          </div>
          <CityIllustration className="pointer-events-none mx-auto -mb-4 w-full max-w-[220px] sm:max-w-[420px]" />
        </div>
      </section>

      {nav.session && (
        <Link to="/navigate" className="mb-6 flex items-center gap-3 rounded-3xl bg-mint p-4 shadow-soft">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-success" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-mint-deep">Navigation active · live hazard alerts on</span>
            <span className="block font-bold leading-snug">{nav.session.destination.label ?? "Destination"}{navRoute ? ` · ${fmtDuration(navRoute.duration_s)} · ${navRoute.label}` : ""}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-mint-deep" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active hazards" value={s?.active ?? "–"} icon={ShieldAlert} tone="rose" onClick={() => navigate("/hazards")}
          hint={closures ? `${closures} confirmed closure${closures > 1 ? "s" : ""}` : "no confirmed closures"} />
        <StatCard label="Pending verification" value={s?.pending ?? "–"} icon={Clock3} tone="peach" onClick={() => navigate("/hazards")} hint="awaiting a safety operator" />
        <StatCard label="Resolved" value={s?.resolved ?? "–"} icon={CheckCircle2} tone="mint" onClick={() => navigate("/hazards")} hint="cleared and reopened" />
        <StatCard label="My reports" value={s?.my_reports ?? "–"} icon={FileText} tone="lavender" onClick={() => navigate("/my-reports")} hint="track their status" />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card card-pad">
          <SectionHeader title="Live hazard map" subtitle="Active reports · closures in red dashed · tap a marker for details"
            right={<Link to="/hazards" className="btn-soft !py-2">Open map <ArrowRight size={15} /></Link>} />
          <NavigationMap className="h-[320px] lg:h-[560px]">
            {active.data && <AffectedPathLines items={active.data} onSelect={(i) => setOpen(i.id)} />}
            {active.data && <HazardMarkers items={active.data} cluster onSelect={(i) => setOpen(i.id)} />}
          </NavigationMap>
        </section>

        <div className="space-y-6">
          <section className="card card-pad">
            <SectionHeader title="Traffic insight" right={<SyntheticBadge note={traffic.data?.data_source.note} />} />
            {!t ? <LoadingSkeleton rows={2} /> : (
              <div className="space-y-3">
                <div className="flex items-center gap-4 rounded-3xl bg-canvas p-4">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: CONGESTION[t.current_level]?.color }}>
                    <Activity size={22} />
                  </span>
                  <div>
                    <div className="text-lg font-extrabold capitalize">{t.current_level} congestion</div>
                    <div className="text-sm text-muted">City-wide estimate · {t.segments_total} corridors</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-3xl bg-peach/60 p-4">
                    <div className="text-xs text-muted">Predicted peak (next 8 h)</div>
                    <div className="text-lg font-extrabold">{fmtTime(t.predicted_peak.time)}</div>
                    <div className="text-xs capitalize text-muted">{t.predicted_peak.level} congestion</div>
                  </div>
                  <div className="rounded-3xl bg-mint/70 p-4">
                    <div className="text-xs text-muted">Busy corridors in 30 min</div>
                    <div className="text-lg font-extrabold">{t.congested_segments_30} of {t.segments_total}</div>
                    <div className="text-xs text-muted">high or severe</div>
                  </div>
                </div>
                {outlook.length > 1 && (
                  <div>
                    <div className="text-xs font-semibold text-muted">City load, next 3 hours</div>
                    <div className="h-20">
                      <ResponsiveContainer>
                        <AreaChart data={outlook} margin={{ top: 6, left: 0, right: 0, bottom: 0 }}>
                          <defs><linearGradient id="ovl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4B860" stopOpacity={0.55} /><stop offset="1" stopColor="#F4B860" stopOpacity={0.05} /></linearGradient></defs>
                          <XAxis dataKey="t" hide />
                          <Tooltip contentStyle={{ borderRadius: 14, border: "none" }} formatter={(v: number) => [`${v}% below free-flow`, "Load"]} />
                          <Area isAnimationActive={false} type="monotone" dataKey="load" stroke="#E9A23F" strokeWidth={2} fill="url(#ovl)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-sm leading-snug text-ink/80">
                      {t.predicted_peak.level === "low"
                        ? "Roads are forecast to stay clear over the next few hours."
                        : `Traffic is forecast to build towards ${fmtTime(t.predicted_peak.time)} (${t.predicted_peak.level}). Check the best time to leave before driving.`}
                    </p>
                  </div>
                )}
                <Link to="/traffic" className="btn-soft w-full">See forecast & best time to leave</Link>
              </div>
            )}
          </section>

          <section className="card card-pad">
            <SectionHeader title="Recent reports" right={<Link to="/hazards" className="text-sm font-semibold text-lavender-deep">View all</Link>} />
            {!s ? <LoadingSkeleton /> : s.recent.length === 0 ? <EmptyState title="No reports yet" action={<Link to="/report" className="btn-soft">Report a hazard</Link>} /> : (
              <div className="space-y-2.5">{s.recent.slice(0, 4).map((i) => <HazardReportCard key={i.id} inc={i} onClick={() => setOpen(i.id)} />)}</div>
            )}
          </section>
        </div>
      </div>
      <Drawer open={open != null} onClose={() => setOpen(null)}>{open != null && <HazardDetailPanel id={open} onClose={() => setOpen(null)} />}</Drawer>
    </div>
  );
}
