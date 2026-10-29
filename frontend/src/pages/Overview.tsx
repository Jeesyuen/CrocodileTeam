import { Activity, ArrowRight, CheckCircle2, Clock3, FileText, Navigation, Plus, ShieldAlert, TrafficCone } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardReportCard } from "@/components/HazardReportCard";
import { CityIllustration } from "@/components/Illustrations";
import { LocationSelector } from "@/components/LocationSelector";
import { NavigationMap } from "@/components/map/MapBase";
import { HazardMarkers } from "@/components/map/layers";
import { Drawer, EmptyState, LoadingSkeleton, SectionHeader, StatCard, SyntheticBadge } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useNav } from "@/context/NavigationContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CONGESTION } from "@/lib/meta";
import type { Incident, TrafficForecast } from "@/lib/types";

interface Summary { total: number; active: number; pending: number; resolved: number; my_reports: number; recent: Incident[] }

export default function Overview() {
  const { user } = useAuth();
  const nav = useNav();
  const navigate = useNavigate();
  const summary = useApi<Summary>("/api/dashboard/summary");
  const active = useApi<Incident[]>("/api/hazards?state=active");
  const traffic = useApi<TrafficForecast>("/api/traffic/forecast");
  const [open, setOpen] = useState<number | null>(null);
  useRealtimeEvent(["hazard.", "demo.reset"], () => { summary.reload(true); active.reload(true); });

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const s = summary.data;
  const t = traffic.data?.summary;

  return (
    <div className="page">
      <section className="relative mb-6 overflow-hidden rounded-4xl bg-gradient-to-br from-lavender via-[#F3F0FF] to-sky p-6 shadow-soft sm:p-8">
        <div className="grid items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="relative z-10">
            <p className="text-sm font-semibold text-lavender-deep">{greet}, {user?.name.split(" ")[0]} 👋</p>
            <h1 className="mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">Where are you heading in Cyberjaya?</h1>
            <div className="mt-5 max-w-lg rounded-3xl bg-white/80 p-2 shadow-soft backdrop-blur">
              <LocationSelector value={null} dot="#7968C9" placeholder="Search a destination — e.g. DPulze, Hospital Cyberjaya"
                onChange={(p) => { if (p) { nav.setDestination(p); navigate("/navigate"); } }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/navigate" className="btn-primary"><Navigation size={16} />Smart Navigation</Link>
              <Link to="/report" className="btn-outline"><Plus size={16} />Report hazard</Link>
              <Link to="/traffic" className="btn-outline"><TrafficCone size={16} />Traffic AI</Link>
            </div>
          </div>
          <CityIllustration className="pointer-events-none mx-auto -mb-4 w-full max-w-[420px]" />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active hazards" value={s?.active ?? "–"} icon={ShieldAlert} tone="rose" onClick={() => navigate("/hazards")} />
        <StatCard label="Pending verification" value={s?.pending ?? "–"} icon={Clock3} tone="peach" onClick={() => navigate("/hazards")} />
        <StatCard label="Resolved" value={s?.resolved ?? "–"} icon={CheckCircle2} tone="mint" onClick={() => navigate("/hazards")} />
        <StatCard label="My reports" value={s?.my_reports ?? "–"} icon={FileText} tone="lavender" onClick={() => navigate("/my-reports")} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card card-pad">
          <SectionHeader title="Live hazard map" subtitle="Active community reports across the pilot area"
            right={<Link to="/hazards" className="btn-soft !py-2">Open map <ArrowRight size={15} /></Link>} />
          <NavigationMap className="h-[320px] lg:h-[560px]">
            {active.data && <HazardMarkers items={active.data} onSelect={(i) => setOpen(i.id)} />}
          </NavigationMap>
        </section>

        <div className="space-y-6">
          <section className="card card-pad">
            <SectionHeader title="Traffic right now" right={<SyntheticBadge note={traffic.data?.data_source.note} />} />
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
                    <div className="text-xs text-muted">Predicted peak</div>
                    <div className="text-lg font-extrabold">{fmtTime(t.predicted_peak.time)}</div>
                    <div className="text-xs capitalize text-muted">{t.predicted_peak.level} congestion</div>
                  </div>
                  <div className="rounded-3xl bg-mint/70 p-4">
                    <div className="text-xs text-muted">Busy corridors in 30 min</div>
                    <div className="text-lg font-extrabold">{t.congested_segments_30}</div>
                    <div className="text-xs text-muted">high or severe</div>
                  </div>
                </div>
                <Link to="/traffic" className="btn-soft w-full">See forecast & best time to leave</Link>
              </div>
            )}
          </section>

          <section className="card card-pad">
            <SectionHeader title="Recent reports" right={<Link to="/hazards" className="text-sm font-semibold text-lavender-deep">View all</Link>} />
            {!s ? <LoadingSkeleton /> : s.recent.length === 0 ? <EmptyState title="No reports yet" /> : (
              <div className="space-y-2.5">{s.recent.slice(0, 4).map((i) => <HazardReportCard key={i.id} inc={i} onClick={() => setOpen(i.id)} />)}</div>
            )}
          </section>
        </div>
      </div>
      <Drawer open={open != null} onClose={() => setOpen(null)}>{open != null && <HazardDetailPanel id={open} onClose={() => setOpen(null)} />}</Drawer>
    </div>
  );
}
