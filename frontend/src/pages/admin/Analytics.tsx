import { Bot, Clock3, MapPin, Navigation, Timer, Wrench } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorNote, LoadingSkeleton, PageHeader, SectionHeader, StatCard, SyntheticBadge } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { useApi } from "@/lib/hooks";
import { categoryMeta, SEVERITY, STATUS } from "@/lib/meta";
import type { Severity, Status } from "@/lib/types";

interface A {
  timeline: { date: string; reported: number; resolved: number }[];
  by_category: { category: string; label: string; count: number }[];
  by_status: { status: Status; count: number }[];
  by_severity: { severity: Severity; count: number }[];
  mean_hours_to_verify: number | null; mean_hours_to_resolve: number | null;
  hotspots: { location: string; count: number }[];
  ai: { analyses: number; by_status: Record<string, number> };
  maintenance: { open: number; awaiting_clearance: number; closed: number };
  active_navigation_sessions: number; rejected_share: number; synthetic_share: number;
}
const tip = { borderRadius: 16, border: "none", boxShadow: "0 12px 32px -16px rgba(0,0,0,.25)" };

export default function Analytics() {
  const { data, error, loading, reload } = useApi<A>("/api/dashboard/analytics");
  useRealtimeEvent(["hazard.", "maintenance.", "demo.reset"], () => reload(true));
  if (error) return <div className="page"><ErrorNote message={error} onRetry={() => reload()} /></div>;
  if (loading || !data) return <div className="page"><LoadingSkeleton rows={6} /></div>;
  const tl = data.timeline.map((d) => ({ ...d, label: new Date(d.date).toLocaleDateString([], { day: "numeric", month: "short" }) }));

  return (
    <div className="page">
      <PageHeader title="Safety analytics" subtitle="Reporting volume, response times and hotspots across the pilot area."
        eyebrow={<SyntheticBadge label={`${Math.round(data.synthetic_share * 100)}% of incidents are synthetic demo records`} />} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Mean time to verify" value={data.mean_hours_to_verify != null ? `${data.mean_hours_to_verify} h` : "–"} icon={Clock3} tone="peach" />
        <StatCard label="Mean time to resolve" value={data.mean_hours_to_resolve != null ? `${data.mean_hours_to_resolve} h` : "–"} icon={Timer} tone="mint" />
        <StatCard label="Open maintenance tasks" value={data.maintenance.open} icon={Wrench} tone="sky" hint={`${data.maintenance.awaiting_clearance} awaiting clearance`} />
        <StatCard label="Active navigation sessions" value={data.active_navigation_sessions} icon={Navigation} tone="lavender" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section className="card card-pad">
          <SectionHeader title="Reports vs resolutions" subtitle="Last 30 days" />
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={tl} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="rep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7968C9" stopOpacity={0.4} /><stop offset="1" stopColor="#7968C9" stopOpacity={0} /></linearGradient>
                  <linearGradient id="res" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#58B99B" stopOpacity={0.4} /><stop offset="1" stopColor="#58B99B" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="reported" name="Reported" stroke="#7968C9" strokeWidth={2.5} fill="url(#rep)" />
                <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#58B99B" strokeWidth={2.5} fill="url(#res)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card card-pad">
          <SectionHeader title="By status" />
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.by_status} dataKey="count" nameKey="status" innerRadius={62} outerRadius={100} paddingAngle={3} cornerRadius={8}>
                  {data.by_status.map((s) => <Cell key={s.status} fill={STATUS[s.status]?.color ?? "#ccc"} />)}
                </Pie>
                <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [v, STATUS[n as Status]?.label ?? n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2">{data.by_status.map((s) => <span key={s.status} className="chip" style={{ background: STATUS[s.status]?.bg, color: STATUS[s.status]?.color }}>{STATUS[s.status]?.label} · {s.count}</span>)}</div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card card-pad lg:col-span-2">
          <SectionHeader title="By category" />
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.by_category} margin={{ left: -20, right: 8 }}>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7B8290" }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7B8290" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} cursor={{ fill: "#F4F1FF" }} />
                <Bar dataKey="count" radius={[10, 10, 4, 4]}>{data.by_category.map((c) => <Cell key={c.category} fill={categoryMeta(c.category).color} fillOpacity={0.8} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card card-pad">
          <SectionHeader title="Hotspots" subtitle="Most-reported roads" />
          <ul className="space-y-2">
            {data.hotspots.map((h, i) => (
              <li key={h.location} className="flex items-center gap-3 rounded-2xl bg-canvas px-3 py-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-xl bg-lavender text-xs font-bold text-lavender-deep">{i + 1}</span>
                <MapPin size={14} className="text-muted" /><span className="flex-1 truncate text-sm font-semibold">{h.location}</span>
                <span className="text-sm text-muted">{h.count}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card card-pad">
          <SectionHeader title="Severity mix" />
          <div className="space-y-3">
            {data.by_severity.map((s) => {
              const total = data.by_severity.reduce((a, b) => a + b.count, 0);
              return (
                <div key={s.severity}>
                  <div className="flex justify-between text-sm"><span className="font-semibold">{SEVERITY[s.severity].label}</span><span className="text-muted">{s.count}</span></div>
                  <div className="mt-1 h-2.5 rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${(s.count / total) * 100}%`, background: SEVERITY[s.severity].color }} /></div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card card-pad">
          <SectionHeader title="AI analysis & data quality" />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-lavender-soft p-4"><Bot size={18} className="text-lavender-deep" /><div className="mt-2 text-2xl font-extrabold">{data.ai.analyses}</div><div className="text-xs text-muted">photo analyses run</div></div>
            <div className="rounded-3xl bg-canvas p-4"><div className="text-2xl font-extrabold">{Math.round(data.rejected_share * 100)}%</div><div className="text-xs text-muted">reports rejected as false</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(data.ai.by_status).map(([k, v]) => <span key={k} className="chip bg-canvas text-muted">{k}: {v}</span>)}
            {!data.ai.analyses && <span className="text-xs text-muted">No photos analysed yet — AI runs only when a photo is uploaded and a key is configured.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
