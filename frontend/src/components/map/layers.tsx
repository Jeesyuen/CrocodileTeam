import { Fragment, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { categoryMeta, CONGESTION, ROUTE_STYLE, SEVERITY } from "@/lib/meta";
import type { Incident, Preference, Route, RoutePlan } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { MapCircle, MapMarker, MapPolyline, MarkerIcon } from "./primitives";

const iconCache = new Map<string, MarkerIcon>();

export function hazardIcon(inc: Pick<Incident, "category" | "severity" | "certainty" | "restriction">, active = false): MarkerIcon {
  const key = `${inc.category}|${inc.severity}|${inc.certainty}|${inc.restriction}|${active}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const m = categoryMeta(inc.category);
  const Icon = m.icon;
  const svg = renderToStaticMarkup(<Icon size={16} color={m.color} strokeWidth={2.4} />);
  const ring = inc.restriction === "closed" ? "#E2545E" : SEVERITY[inc.severity].color;
  const faded = inc.certainty === "resolved" || inc.certainty === "rejected" || inc.certainty === "duplicate";
  const dashed = inc.certainty === "reported";
  const size = active ? 44 : 36;
  const html = `<div style="width:${size}px;height:${size + 8}px;position:relative;opacity:${faded ? 0.55 : 1}">
    <div style="width:${size}px;height:${size}px;border-radius:14px;background:${m.bg};border:2.5px ${dashed ? "dashed" : "solid"} ${ring};
      display:grid;place-items:center;box-shadow:0 8px 18px -8px rgba(32,33,36,.45);transform:${active ? "scale(1.05)" : "none"}">${svg}</div>
    <div style="position:absolute;left:50%;bottom:0;width:8px;height:8px;margin-left:-4px;border-radius:999px;background:${ring};border:2px solid #fff"></div>
    ${inc.restriction === "closed" ? `<div style="position:absolute;right:-6px;top:-6px;background:#E2545E;color:#fff;font:700 9px/1 sans-serif;padding:3px 5px;border-radius:8px;border:2px solid #fff">CLOSED</div>` : ""}
  </div>`;
  const icon: MarkerIcon = { html, size: [size, size + 8], anchor: [size / 2, size + 6] };
  iconCache.set(key, icon);
  return icon;
}

export function HazardMarkers({ items, onSelect, selectedId, popups = true }: {
  items: Incident[]; onSelect?: (i: Incident) => void; selectedId?: number | null; popups?: boolean;
}) {
  return (
    <>
      {items.map((i) => (
        <MapMarker key={i.id} position={[i.lat, i.lon]} icon={hazardIcon(i, i.id === selectedId)}
          zIndex={i.id === selectedId ? 1000 : i.restriction === "closed" ? 500 : 0}
          onClick={onSelect ? () => onSelect(i) : undefined}
          tooltip={onSelect ? `${i.category_label} · ${i.location_label}` : undefined}
          popup={popups && !onSelect ? (
            <>
              <div className="font-bold">{i.category_label}</div>
              <div className="text-muted">{i.location_label} · {timeAgo(i.created_at)}</div>
              <div className="mt-1">{i.description}</div>
            </>
          ) : undefined} />
      ))}
    </>
  );
}

export function RouteLines({ plan, selected, onSelect, showCongestion = true }: {
  plan: RoutePlan; selected: Preference; onSelect?: (p: Preference) => void; showCongestion?: boolean;
}) {
  const ordered = useMemo(() => {
    const uniq = plan.routes.filter((r) => !r.same_as || r.preference === selected);
    return [...uniq].sort((a) => (a.preference === selected ? 1 : -1));
  }, [plan, selected]);
  const sel = plan.routes.find((r) => r.preference === selected) ?? plan.routes[0];
  const start = plan.access.origin, end = plan.access.destination;
  return (
    <>
      {ordered.map((r) => <RouteLine key={r.preference} route={r} active={r.preference === selected} onClick={() => onSelect?.(r.preference as Preference)} />)}
      {showCongestion && sel.congestion.map((c, i) => (
        <MapPolyline key={`c${i}`} positions={c.geometry} color={CONGESTION[c.level].color} weight={7} opacity={0.95} zIndex={30}
          tooltip={`${c.predicted ? "Predicted" : "Estimated"} ${CONGESTION[c.level].label.toLowerCase()} congestion${c.road ? ` · ${c.road}` : ""}`} />
      ))}
      {/* walking connectors from the exact point to the network are drawn dashed — they are not roads */}
      {start.distance_m > 5 && <MapPolyline positions={[start.from as [number, number], start.to as [number, number]]} color="#9AA1AD" weight={3} dash="4 7" zIndex={30} />}
      {end.distance_m > 5 && <MapPolyline positions={[end.from as [number, number], end.to as [number, number]]} color="#9AA1AD" weight={3} dash="4 7" zIndex={30} />}
      <MapCircle center={start.from as [number, number]} radius={8} color="#fff" weight={3} fillColor="#3FAE97" tooltip="Start" />
      <MapMarker position={end.to as [number, number]} icon={destIcon} tooltip="Destination" />
    </>
  );
}

export function RouteLine({ route, active, onClick, color }: { route: Route; active: boolean; onClick?: () => void; color?: string }) {
  const st = ROUTE_STYLE[route.preference];
  const z = active ? 20 : 10;
  return (
    <Fragment>
      <MapPolyline positions={route.geometry} color="#fff" weight={active ? 11 : 8} opacity={active ? 1 : 0.8} zIndex={z} onClick={onClick} />
      <MapPolyline positions={route.geometry} color={color ?? st.color} weight={active ? 6 : 4} opacity={active ? 1 : 0.55} zIndex={z + 1}
        onClick={onClick} tooltip={route.label} />
    </Fragment>
  );
}

export const destIcon: MarkerIcon = {
  html: `<svg width="34" height="42" viewBox="-17 -38 34 42"><ellipse cx="0" cy="2" rx="8" ry="3" fill="#202124" opacity=".15"/><path d="M0 0 C-10 -11 -13 -17 -13 -23 A13 13 0 0 1 13 -23 C13 -17 10 -11 0 0 Z" fill="#7968C9" stroke="#fff" stroke-width="2.5"/><circle cx="0" cy="-23" r="5" fill="#DDF2F1"/></svg>`,
  size: [34, 42], anchor: [17, 38],
};

export const pinIcon: MarkerIcon = {
  html: `<svg width="34" height="42" viewBox="-17 -38 34 42"><ellipse cx="0" cy="2" rx="8" ry="3" fill="#202124" opacity=".15"/><path d="M0 0 C-10 -11 -13 -17 -13 -23 A13 13 0 0 1 13 -23 C13 -17 10 -11 0 0 Z" fill="#F27C83" stroke="#fff" stroke-width="2.5"/><circle cx="0" cy="-23" r="5" fill="#fff"/></svg>`,
  size: [34, 42], anchor: [17, 38],
};
