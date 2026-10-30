import { Fragment, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { categoryMeta, CONGESTION, ROUTE_STYLE, SEVERITY } from "@/lib/meta";
import type { Incident, Preference, Route, RoutePlan } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { MapCircle, MapMarker, MapPolyline, MarkerIcon, useMapView } from "./primitives";

const iconCache = new Map<string, MarkerIcon>();

export function hazardIcon(inc: Pick<Incident, "category" | "severity" | "certainty" | "restriction">, active = false, onRoute = false): MarkerIcon {
  const key = `${inc.category}|${inc.severity}|${inc.certainty}|${inc.restriction}|${active}|${onRoute}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const m = categoryMeta(inc.category);
  const Icon = m.icon;
  const svg = renderToStaticMarkup(<Icon size={16} color={m.color} strokeWidth={2.4} />);
  const ring = inc.restriction === "closed" ? "#E2545E" : SEVERITY[inc.severity].color;
  const faded = inc.certainty === "resolved" || inc.certainty === "rejected" || inc.certainty === "duplicate";
  const dashed = inc.certainty === "reported";
  const size = active ? 44 : 36;
  const html = `<div style="width:${size}px;height:${size + 8}px;position:relative;isolation:isolate;opacity:${faded ? 0.55 : 1}">
    <div style="width:${size}px;height:${size}px;border-radius:14px;background:${m.bg};border:2.5px ${dashed ? "dashed" : "solid"} ${ring};
      display:grid;place-items:center;box-shadow:0 8px 18px -8px rgba(32,33,36,.45);transform:${active ? "scale(1.05)" : "none"}">${svg}</div>
    <div style="position:absolute;left:50%;bottom:0;width:8px;height:8px;margin-left:-4px;border-radius:999px;background:${ring};border:2px solid #fff"></div>
    ${onRoute ? `<span class="animate-pulse" style="position:absolute;left:-6px;top:-6px;width:${size + 12}px;height:${size + 12}px;border-radius:18px;background:${ring};opacity:.28;z-index:-1"></span>` : ""}
    ${inc.restriction === "closed" ? `<div style="position:absolute;right:-6px;top:-6px;background:#E2545E;color:#fff;font:700 9px/1 sans-serif;padding:3px 5px;border-radius:8px;border:2px solid #fff">CLOSED</div>`
    : onRoute ? `<div style="position:absolute;right:-8px;top:-7px;background:#202124;color:#fff;font:700 8px/1 sans-serif;padding:3px 4px;border-radius:7px;border:2px solid #fff">ON ROUTE</div>` : ""}
  </div>`;
  const icon: MarkerIcon = { html, size: [size, size + 8], anchor: [size / 2, size + 6] };
  iconCache.set(key, icon);
  return icon;
}

export function HazardMarkers({ items, onSelect, selectedId, popups = true, highlightIds, cluster }: {
  items: Incident[]; onSelect?: (i: Incident) => void; selectedId?: number | null; popups?: boolean;
  /** hazards on the user's selected route get a halo and an ON ROUTE tag */
  highlightIds?: Set<number>;
  /** group nearby markers into count bubbles when zoomed out */
  cluster?: boolean;
}) {
  if (cluster) return <ClusteredHazards items={items} onSelect={onSelect} selectedId={selectedId} highlightIds={highlightIds} />;
  return (
    <>
      {items.map((i) => (
        <MapMarker key={i.id} position={[i.lat, i.lon]} icon={hazardIcon(i, i.id === selectedId, highlightIds?.has(i.id))}
          zIndex={i.id === selectedId ? 1000 : highlightIds?.has(i.id) ? 800 : i.restriction === "closed" ? 500 : 0}
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

/* ---------- clustering ---------- */

const clusterIcons = new Map<string, MarkerIcon>();
function clusterIcon(n: number, color: string, closed: boolean): MarkerIcon {
  const key = `${n}|${color}|${closed}`;
  let ic = clusterIcons.get(key);
  if (!ic) {
    const d = n < 10 ? 40 : 48;
    ic = {
      html: `<div style="width:${d}px;height:${d}px;border-radius:999px;background:#fff;border:3px solid ${color};box-shadow:0 8px 18px -8px rgba(32,33,36,.45);display:grid;place-items:center;font:800 14px/1 'Plus Jakarta Sans',sans-serif;color:#202124;position:relative">${n}${closed ? `<span style="position:absolute;right:-4px;top:-4px;width:12px;height:12px;border-radius:999px;background:#E2545E;border:2px solid #fff"></span>` : ""}</div>`,
      size: [d, d], anchor: [d / 2, d / 2],
    };
    clusterIcons.set(key, ic);
  }
  return ic;
}
const SEV_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

/** Grid clustering in screen space (~64 px cells), recomputed on zoom. Stops clustering from zoom 17. */
function ClusteredHazards({ items, onSelect, selectedId, highlightIds }: {
  items: Incident[]; onSelect?: (i: Incident) => void; selectedId?: number | null; highlightIds?: Set<number>;
}) {
  const { zoom, focus } = useMapView();
  const groups = useMemo(() => {
    if (zoom >= 17) return items.map((i) => [i]);
    const cell = (64 * 360) / (256 * 2 ** zoom); // degrees per 64 px at this zoom (lat≈lon scale near the equator)
    const m = new Map<string, Incident[]>();
    for (const i of items) {
      const k = `${Math.floor(i.lat / cell)}:${Math.floor(i.lon / cell)}`;
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.values()];
  }, [items, zoom]);
  return (
    <>
      {groups.map((g) => {
        if (g.length === 1 || g.some((i) => i.id === selectedId)) {
          return g.map((i) => (
            <MapMarker key={i.id} position={[i.lat, i.lon]} icon={hazardIcon(i, i.id === selectedId, highlightIds?.has(i.id))}
              zIndex={i.id === selectedId ? 1000 : highlightIds?.has(i.id) ? 800 : 0}
              onClick={onSelect ? () => onSelect(i) : undefined} tooltip={`${i.category_label} · ${i.location_label}`} />
          ));
        }
        const lat = g.reduce((a, i) => a + i.lat, 0) / g.length, lon = g.reduce((a, i) => a + i.lon, 0) / g.length;
        const worst = g.reduce((a, i) => (SEV_RANK[i.severity] > SEV_RANK[a.severity] ? i : a));
        const closed = g.some((i) => i.restriction === "closed");
        return (
          <MapMarker key={`c${g.map((i) => i.id).join("-")}`} position={[lat, lon]} zIndex={600}
            icon={clusterIcon(g.length, closed ? "#E2545E" : SEVERITY[worst.severity].color, closed)}
            onClick={() => focus([lat, lon], Math.min(zoom + 2, 18))}
            tooltip={`${g.length} hazards · tap to zoom in`} />
        );
      })}
    </>
  );
}

/* ---------- affected paths (closures / cautions) and reroute ghost ---------- */

/** Draws the mapped path segments a hazard affects: confirmed closures in red, cautions in amber. */
export function AffectedPathLines({ items, onSelect }: { items: Incident[]; onSelect?: (i: Incident) => void }) {
  return (
    <>
      {items.flatMap((i) => (i.affected_paths ?? []).filter((p) => p.active).map((p, k) => {
        const closed = p.impact_type === "closure";
        const tip = `${closed ? "Closed" : "Caution"}: ${p.road ?? "path"} · ${i.category_label} (${i.certainty === "reported" ? "unverified" : i.certainty.replace("_", " ")})`;
        return (
          <Fragment key={`${i.id}-${k}`}>
            <MapPolyline positions={p.geometry} color="#fff" weight={closed ? 10 : 9} opacity={0.9} zIndex={25} />
            <MapPolyline positions={p.geometry} color={closed ? "#E2545E" : i.certainty === "reported" ? "#F4B860" : "#F09A4A"}
              weight={closed ? 6 : 5} dash={closed ? "8 6" : undefined} opacity={0.95} zIndex={26}
              tooltip={tip} onClick={onSelect ? () => onSelect(i) : undefined} />
          </Fragment>
        );
      }))}
    </>
  );
}

/** The route you were on before a reroute, drawn as a grey dashed line under the new one. */
export function GhostRoute({ route }: { route: Route }) {
  return <MapPolyline positions={route.geometry} color="#7B8290" weight={5} opacity={0.75} dash="2 9" zIndex={5} tooltip={`Previous route · ${route.label}`} />;
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
