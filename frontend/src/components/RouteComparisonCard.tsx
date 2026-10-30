import clsx from "clsx";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Gauge, Moon, Route as RouteIcon, ShieldCheck, Sparkles, TrafficCone, Zap } from "lucide-react";
import { fmtDistance, fmtDuration, fmtTime } from "@/lib/format";
import { ROUTE_STYLE } from "@/lib/meta";
import type { Route } from "@/lib/types";
import { SafetyScoreBadge } from "./ui";

const ICON = { safest: ShieldCheck, balanced: Gauge, fastest: Zap, usual: RouteIcon };

/** "+2 min · +11 safety" relative to another route; empty when the difference is negligible. */
export function routeDelta(route: Route, ref: Route) {
  const parts: { text: string; good: boolean }[] = [];
  const dt = route.duration_s - ref.duration_s;
  if (Math.abs(dt) >= 30) parts.push({ text: `${dt > 0 ? "+" : "−"}${fmtDuration(Math.abs(dt))}`, good: dt < 0 });
  const ds = route.safety.score - ref.safety.score;
  if (Math.abs(ds) >= 1) parts.push({ text: `${ds > 0 ? "+" : "−"}${Math.abs(ds)} safety`, good: ds > 0 });
  const dh = route.hazard_ids.length - ref.hazard_ids.length;
  if (dh !== 0) parts.push({ text: `${dh > 0 ? "+" : "−"}${Math.abs(dh)} hazard${Math.abs(dh) > 1 ? "s" : ""}`, good: dh < 0 });
  return parts;
}

export function RouteComparisonCard({ route, selected, recommended, onSelect, compact, compareTo, compareLabel }: {
  route: Route; selected: boolean; recommended?: boolean; onSelect: () => void; compact?: boolean;
  /** show time/safety/hazard differences against this route (usually the recommended one) */
  compareTo?: Route | null; compareLabel?: string;
}) {
  const st = ROUTE_STYLE[route.preference];
  const Icon = ICON[route.preference];
  const hazards = route.hazard_ids.length;
  const delta = compareTo && compareTo !== route ? routeDelta(route, compareTo) : [];
  const sameAs = route.same_as ? ROUTE_STYLE[route.same_as].label : null;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={clsx("relative w-full overflow-hidden rounded-3xl bg-white text-left transition ring-1",
        compact ? "p-3.5" : "p-4", selected ? "shadow-float ring-2" : "ring-line hover:shadow-soft")}
      style={selected ? { ["--tw-ring-color" as string]: st.color } : undefined}>
      {/* colour key matching the line on the map */}
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: st.color, opacity: selected ? 1 : 0.45 }} />
      {recommended && (
        <span className="absolute right-0 top-0 flex items-center gap-1 rounded-bl-2xl bg-lavender-deep px-3 py-1 text-[11px] font-bold text-white">
          <Sparkles size={12} />AI recommended
        </span>
      )}
      <div className="flex items-start gap-3 pl-1">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl" style={{ background: st.soft, color: st.color }}>
          <Icon size={19} strokeWidth={2.3} />
        </span>
        <div className={clsx("min-w-0 flex-1", recommended && "pr-28")}>
          <div className="font-bold leading-snug">{route.label}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
            <span className="flex items-center gap-1 text-lg font-extrabold text-ink"><Clock size={14} className="self-center" />{fmtDuration(route.duration_s)}</span>
            <span>arrive ≈ {fmtTime(route.arrival)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 pl-1">
        <Metric label="Distance" value={fmtDistance(route.distance_m)} />
        <Metric label="Safety score" value={<span className="flex items-center gap-1.5"><SafetyScoreBadge score={route.safety.score} size="sm" /><span className="text-xs font-semibold capitalize text-muted">{route.safety.risk_level}</span></span>} />
        <Metric label="Hazards" value={hazards > 0
          ? <span className="flex items-center gap-1 text-[#C4444E]"><AlertTriangle size={14} />{hazards} on route</span>
          : <span className="flex items-center gap-1 text-mint-deep"><CheckCircle2 size={14} />None</span>} />
      </div>

      {(delta.length > 0 || sameAs || (route.delay_s != null && route.delay_s > 60)) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-1 text-xs">
          {sameAs && <span className="chip bg-canvas text-muted">Same path as {sameAs}</span>}
          {route.delay_s != null && route.delay_s > 60 && <span className="chip bg-peach text-[#B7791F]"><TrafficCone size={12} />+{fmtDuration(route.delay_s)} traffic delay</span>}
          {delta.length > 0 && <span className="text-muted">vs {compareLabel ?? "recommended"}:</span>}
          {delta.map((d) => <span key={d.text} className={clsx("font-bold", d.good ? "text-mint-deep" : "text-[#C27A2C]")}>{d.text}</span>)}
        </div>
      )}

      {!compact && (
        <>
          <p className="mt-3 rounded-2xl bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink/80">
            <span className="font-bold text-ink">Why: </span>{route.explanation}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
            {route.via.length > 0 && <span className="chip bg-sky text-sky-deep">via {route.via.slice(0, 2).join(", ")}</span>}
            {route.safety.conditions.night && <span className="chip bg-lavender-soft text-lavender-deep"><Moon size={12} />Night</span>}
            <span className="chip bg-canvas text-muted" title="Share of route with known lighting/surface data">Data confidence: {route.safety.confidence_label}</span>
            {selected && <span className="chip bg-lavender text-lavender-deep">Shown on map</span>}
          </div>
        </>
      )}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-canvas px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}
