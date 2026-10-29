/**
 * Map primitives that render on whichever base map is active (Leaflet/OSM or Google Maps).
 * Pages draw markers and lines through these so they never depend on one map library.
 */
import L from "leaflet";
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CircleMarker, Marker, Polyline, Popup, Tooltip } from "react-leaflet";
import { readPosition, toLL } from "./google";

export interface MarkerIcon { html: string; size: [number, number]; anchor: [number, number] }

export type Engine =
  | { kind: "leaflet" }
  | {
    kind: "google"; map: google.maps.Map;
    hover: (text: string | null, e?: Event) => void;
    popup: (html: string, anchor: google.maps.marker.AdvancedMarkerElement) => void;
  };

export const EngineCtx = createContext<Engine>({ kind: "leaflet" });
const useEngine = () => useContext(EngineCtx);

const leafletIcons = new WeakMap<MarkerIcon, L.DivIcon>();
function leafletIcon(icon: MarkerIcon) {
  let d = leafletIcons.get(icon);
  if (!d) {
    d = L.divIcon({ className: "sr-marker", html: icon.html, iconSize: icon.size, iconAnchor: icon.anchor });
    leafletIcons.set(icon, d);
  }
  return d;
}

interface MarkerProps {
  position: [number, number]; icon: MarkerIcon; zIndex?: number; opacity?: number;
  draggable?: boolean; onDragEnd?: (lat: number, lon: number) => void;
  onClick?: () => void; tooltip?: string; popup?: ReactNode;
}

export function MapMarker(p: MarkerProps) {
  const engine = useEngine();
  if (engine.kind === "google") return <GoogleMarker engine={engine} {...p} />;
  return (
    <Marker position={p.position} icon={leafletIcon(p.icon)} zIndexOffset={p.zIndex ?? 0} opacity={p.opacity ?? 1}
      draggable={p.draggable}
      eventHandlers={{
        click: () => p.onClick?.(),
        dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); p.onDragEnd?.(ll.lat, ll.lng); },
      }}>
      {p.popup && <Popup>{p.popup}</Popup>}
      {p.tooltip && <Tooltip direction="top" offset={[p.icon.size[0] / 2 - p.icon.anchor[0], -p.icon.anchor[1] + 6]}>{p.tooltip}</Tooltip>}
    </Marker>
  );
}

function GoogleMarker({ engine, ...p }: MarkerProps & { engine: Extract<Engine, { kind: "google" }> }) {
  const ref = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    const m = new google.maps.marker.AdvancedMarkerElement({ map: engine.map, position: toLL(cb.current.position) });
    ref.current = m;
    const drag = cb.current.onDragEnd
      ? m.addListener("dragend", () => { const ll = readPosition(m.position); if (ll) cb.current.onDragEnd?.(ll[0], ll[1]); })
      : null;
    // a clickable marker swallows map clicks, so only make it clickable when it is interactive
    const click = () => {
      const c = cb.current;
      if (c.popup) engine.popup(renderToStaticMarkup(<div className="text-xs">{c.popup}</div>), m);
      c.onClick?.();
    };
    const interactive = !!(cb.current.onClick || cb.current.popup);
    if (interactive) {
      Object.assign(m, { gmpClickable: true });
      m.addEventListener("gmp-click", click);
    }
    return () => { drag?.remove(); m.removeEventListener("gmp-click", click); m.map = null; ref.current = null; };
  }, [engine]);

  useEffect(() => { if (ref.current) ref.current.position = toLL(p.position); }, [p.position[0], p.position[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ref.current) return;
    ref.current.zIndex = p.zIndex ?? null;
    ref.current.gmpDraggable = !!p.draggable;
  }, [p.zIndex, p.draggable]);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const { html, size, anchor } = p.icon;
    const el = document.createElement("div");
    el.innerHTML = html;
    // Advanced markers anchor at bottom-centre; shift so the icon's own anchor sits on the point.
    el.style.cssText = `width:${size[0]}px;height:${size[1]}px;opacity:${p.opacity ?? 1};transform:translate(${size[0] / 2 - anchor[0]}px,${size[1] - anchor[1]}px)`;
    if (p.tooltip) {
      const text = p.tooltip;
      el.addEventListener("mousemove", (e) => engine.hover(text, e));
      el.addEventListener("mouseleave", () => engine.hover(null));
      el.setAttribute("aria-label", text);
    }
    m.content = el;
    return () => engine.hover(null);
  }, [engine, p.icon, p.opacity, p.tooltip]);

  return null;
}

interface LineProps {
  positions: [number, number][]; color: string; weight: number; opacity?: number;
  /** Leaflet-style dash pattern, e.g. "4 7" (dash length, gap in px). */
  dash?: string; zIndex?: number; onClick?: () => void; tooltip?: string;
}

export function MapPolyline(p: LineProps) {
  const engine = useEngine();
  if (engine.kind === "google") return <GooglePolyline engine={engine} {...p} />;
  return (
    <Polyline positions={p.positions}
      pathOptions={{ color: p.color, weight: p.weight, opacity: p.opacity ?? 1, dashArray: p.dash, lineCap: "round", lineJoin: "round" }}
      eventHandlers={p.onClick ? { click: p.onClick } : undefined}>
      {p.tooltip && <Tooltip sticky>{p.tooltip}</Tooltip>}
    </Polyline>
  );
}

function GooglePolyline({ engine, ...p }: LineProps & { engine: Extract<Engine, { kind: "google" }> }) {
  const ref = useRef<google.maps.Polyline | null>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    const line = new google.maps.Polyline({ map: engine.map });
    ref.current = line;
    const ls = [
      line.addListener("click", () => cb.current.onClick?.()),
      line.addListener("mousemove", (e: google.maps.PolyMouseEvent) => { if (cb.current.tooltip) engine.hover(cb.current.tooltip, e.domEvent); }),
      line.addListener("mouseout", () => engine.hover(null)),
    ];
    return () => { ls.forEach((l) => l.remove()); line.setMap(null); ref.current = null; };
  }, [engine]);

  useEffect(() => { ref.current?.setPath(p.positions.map(toLL)); }, [p.positions]);

  useEffect(() => {
    const opacity = p.opacity ?? 1;
    const clickable = !!(p.onClick || p.tooltip);
    if (!p.dash) {
      ref.current?.setOptions({ strokeColor: p.color, strokeWeight: p.weight, strokeOpacity: opacity, icons: [], zIndex: p.zIndex, clickable });
      return;
    }
    // Google polylines have no dash style: draw repeated line symbols instead.
    const [len, gap] = p.dash.split(/\s+/).map(Number);
    ref.current?.setOptions({
      strokeOpacity: 0, zIndex: p.zIndex, clickable,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeColor: p.color, strokeOpacity: opacity, strokeWeight: p.weight, scale: Math.max(len / 2, 0.5) },
        offset: "0", repeat: `${len + (gap || len) + p.weight}px`,
      }],
    });
  }, [p.color, p.weight, p.opacity, p.dash, p.zIndex, p.onClick, p.tooltip]);

  return null;
}

export function MapCircle({ center, radius, color, weight, fillColor, tooltip }: {
  center: [number, number]; radius: number; color: string; weight: number; fillColor: string; tooltip?: string;
}) {
  const engine = useEngine();
  const icon = useMemo<MarkerIcon>(() => {
    const d = (radius + weight) * 2;
    return {
      html: `<div style="width:${d}px;height:${d}px;box-sizing:border-box;border-radius:999px;background:${fillColor};border:${weight}px solid ${color}"></div>`,
      size: [d, d], anchor: [d / 2, d / 2],
    };
  }, [radius, weight, color, fillColor]);
  if (engine.kind === "google") return <GoogleMarker engine={engine} position={center} icon={icon} tooltip={tooltip} />;
  return (
    <CircleMarker center={center} radius={radius} pathOptions={{ color, weight, fillColor, fillOpacity: 1 }}>
      {tooltip && <Tooltip>{tooltip}</Tooltip>}
    </CircleMarker>
  );
}
