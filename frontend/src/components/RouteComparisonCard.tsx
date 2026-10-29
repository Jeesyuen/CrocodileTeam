import clsx from "clsx";
import { AlertTriangle, Clock, Gauge, Moon, Route as RouteIcon, ShieldCheck, Zap } from "lucide-react";
import { fmtDistance, fmtDuration } from "@/lib/format";
import { ROUTE_STYLE } from "@/lib/meta";
import type { Route } from "@/lib/types";
import { SafetyScoreBadge } from "./ui";

const ICON = { safest: ShieldCheck, balanced: Gauge, fastest: Zap, usual: RouteIcon };

export function RouteComparisonCard({ route, selected, recommended, onSelect, compact }: {
  route: Route; selected: boolean; recommended?: boolean; onSelect: () => void; compact?: boolean;
}) {
  const st = ROUTE_STYLE[route.preference];
  const Icon = ICON[route.preference];
  return (
    <button type="button" onClick={onSelect}
      className={clsx("w-full rounded-3xl bg-white p-4 text-left transition ring-1",
        selected ? "shadow-float ring-2" : "ring-line hover:shadow-soft")}
      style={selected ? { ["--tw-ring-color" as string]: st.color } : undefined}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl" style={{ background: st.soft, color: st.color }}>
          <Icon size={19} strokeWidth={2.3} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold">{route.label}</span>
            {recommended && <span className="chip bg-lavender text-lavender-deep">Recommended</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
            <span className="flex items-center gap-1 font-semibold text-ink"><Clock size={13} />{fmtDuration(route.duration_s)}</span>
            <span>{fmtDistance(route.distance_m)}</span>
            {route.delay_s != null && route.delay_s > 60 && <span className="text-[#C27A2C]">+{fmtDuration(route.delay_s)} traffic</span>}
          </div>
        </div>
        <SafetyScoreBadge score={route.safety.score} size="sm" />
      </div>
      {!compact && (
        <>
          <p className="mt-3 text-[13px] leading-relaxed text-ink/80">{route.explanation}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {route.hazard_ids.length > 0 ? (
              <span className="chip bg-[#FDE4E6] text-[#C4444E]"><AlertTriangle size={12} />{route.hazard_ids.length} hazard{route.hazard_ids.length > 1 ? "s" : ""} on route</span>
            ) : <span className="chip bg-mint text-mint-deep"><ShieldCheck size={12} />No active hazards</span>}
            {route.safety.conditions.night && <span className="chip bg-lavender-soft text-lavender-deep"><Moon size={12} />Night</span>}
            <span className="chip bg-canvas text-muted" title="Share of route with known lighting/surface data">Data confidence: {route.safety.confidence_label}</span>
          </div>
        </>
      )}
    </button>
  );
}
