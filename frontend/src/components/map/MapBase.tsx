import clsx from "clsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, LocateFixed } from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { PILOT_LITERAL, readPosition, toLL } from "./google";
import { Engine, EngineCtx, MapMarker, MarkerIcon } from "./primitives";
import { useMapProvider } from "./provider";

export const PILOT_BOUNDS: L.LatLngBoundsExpression = [[2.905, 101.63], [2.935, 101.665]];
const MAX_BOUNDS = { south: 2.88, west: 101.6, north: 2.96, east: 101.7 };
// Override with VITE_MAP_TILE_URL for production (OSM's public tiles are for light use only).
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined)
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const CENTER: [number, number] = [2.9230, 101.6440];
const inPilot = (lat: number, lon: number) => lat >= 2.905 && lat <= 2.935 && lon >= 101.63 && lon <= 101.665;

interface MapApi { recenter: () => void; flyTo: (p: [number, number], zoom: number) => void }
interface ViewProps {
  children?: ReactNode; onMapClick?: (lat: number, lon: number) => void;
  fitTo?: [number, number][] | null; fitKey?: string; onApi: (a: MapApi) => void;
}

const meIcon: MarkerIcon = {
  html: `<div style="position:relative;width:22px;height:22px"><span style="position:absolute;inset:0;border-radius:999px;background:#7968C9;opacity:.35" class="animate-pulseRing"></span><span style="position:absolute;inset:4px;border-radius:999px;background:#7968C9;border:3px solid #fff;box-shadow:0 4px 10px rgba(121,104,201,.5)"></span></div>`,
  size: [22, 22], anchor: [11, 11],
};

export function NavigationMap({ children, className, onMapClick, fitTo, fitKey, showLocate = true, overlay }: {
  children?: ReactNode; className?: string; onMapClick?: (lat: number, lon: number) => void;
  fitTo?: [number, number][] | null; fitKey?: string; showLocate?: boolean; overlay?: ReactNode;
}) {
  const provider = useMapProvider();
  const [mapApi, setMapApi] = useState<MapApi | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const google = provider.kind === "google";

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); };
  const locate = () => {
    if (!navigator.geolocation) { flash("Location is not available in this browser"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: [number, number] = [p.coords.latitude, p.coords.longitude];
        if (!inPilot(...ll)) { flash("You're outside the Cyberjaya pilot area"); return; }
        setMe(ll);
        mapApi?.flyTo(ll, 17);
      },
      () => flash("Location permission denied"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const view: ViewProps = {
    onMapClick, fitTo, fitKey, onApi: setMapApi,
    children: <>{children}{me && <MapMarker position={me} icon={meIcon} />}</>,
  };
  const label = google
    ? "Google Maps base map · routes by SafeRoute engine (OpenStreetMap network)"
    : provider.fallbackReason
      ? `${provider.fallbackReason} · demo map (OpenStreetMap)`
      : "Demo map (OpenStreetMap) · routes by SafeRoute engine";

  return (
    <div className={clsx("relative overflow-hidden rounded-4xl bg-line shadow-soft", className)}>
      {!provider.ready ? <div className="h-full w-full animate-pulse bg-line" />
        : google ? <GoogleMapView key="google" mapId={provider.mapId} {...view} />
          : <LeafletMapView key="leaflet" {...view} />}
      {provider.ready && (
        <div className={clsx("absolute right-[10px] z-[500] flex flex-col gap-2", google ? "bottom-[132px]" : "bottom-24")}>
          <MapBtn title="Recenter on Cyberjaya" onClick={() => mapApi?.recenter()}><Crosshair size={18} /></MapBtn>
          {showLocate && <MapBtn title="My location" onClick={locate}><LocateFixed size={18} /></MapBtn>}
        </div>
      )}
      <div className={clsx("pointer-events-none absolute z-[500] max-w-[70%] truncate rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-muted shadow-soft",
        google ? "bottom-7 left-2" : "bottom-2 left-3")}>
        {label}
      </div>
      {msg && <div className="absolute left-1/2 top-4 z-[600] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-xs font-semibold text-white">{msg}</div>}
      {overlay}
    </div>
  );
}

/* ---------- Leaflet + OpenStreetMap (demo fallback) ---------- */

function LeafletMapView({ children, onMapClick, fitTo, fitKey, onApi }: ViewProps) {
  return (
    <MapContainer center={CENTER} zoom={15} minZoom={13} maxZoom={19} zoomControl={false} className="h-full w-full"
      maxBounds={[[MAX_BOUNDS.south, MAX_BOUNDS.west], [MAX_BOUNDS.north, MAX_BOUNDS.east]]} maxBoundsViscosity={0.8}>
      <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
      <ZoomControl />
      <LeafletApi onApi={onApi} />
      {onMapClick && <ClickHandler onClick={onMapClick} />}
      {fitTo && fitTo.length > 1 && <FitBounds points={fitTo} k={fitKey} />}
      {children}
    </MapContainer>
  );
}

function LeafletApi({ onApi }: { onApi: (a: MapApi) => void }) {
  const map = useMap();
  useEffect(() => {
    onApi({ recenter: () => map.flyToBounds(PILOT_BOUNDS, { duration: 0.6 }), flyTo: (p, z) => map.flyTo(p, z) });
  }, [map, onApi]);
  return null;
}

function ZoomControl() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: "bottomright" }).addTo(map);
    return () => { z.remove(); };
  }, [map]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FitBounds({ points, k }: { points: [number, number][]; k?: string }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, k]);
  return null;
}

/* ---------- Google Maps ---------- */

function GoogleMapView({ mapId, children, onMapClick, fitTo, fitKey, onApi }: ViewProps & { mapId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const info = useRef<google.maps.InfoWindow | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    const m = new google.maps.Map(el.current!, {
      center: toLL(CENTER), zoom: 15, minZoom: 13, maxZoom: 20, mapId,
      disableDefaultUI: true, zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      clickableIcons: false, gestureHandling: "greedy",
      restriction: { latLngBounds: MAX_BOUNDS, strictBounds: false },
    });
    info.current = new google.maps.InfoWindow();
    const click = m.addListener("click", (e: google.maps.MapMouseEvent) => {
      const p = readPosition(e.latLng);
      if (p) clickRef.current?.(p[0], p[1]);
    });
    setMap(m);
    onApi({ recenter: () => m.fitBounds(PILOT_LITERAL, 0), flyTo: (p, z) => { m.panTo(toLL(p)); m.setZoom(z); } });
    return () => { click.remove(); info.current?.close(); setMap(null); };
  }, [mapId, onApi]);

  useEffect(() => { map?.setOptions({ draggableCursor: onMapClick ? "crosshair" : null }); }, [map, onMapClick]);

  const hasFit = !!fitTo && fitTo.length > 1;
  useEffect(() => {
    if (!map || !fitTo || fitTo.length < 2) return;
    const b = new google.maps.LatLngBounds();
    fitTo.forEach((p) => b.extend(toLL(p)));
    map.fitBounds(b, 60);
    google.maps.event.addListenerOnce(map, "idle", () => { if ((map.getZoom() ?? 0) > 17) map.setZoom(17); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, hasFit]);

  const showHover = useCallback((text: string | null, e?: Event) => {
    const r = box.current?.getBoundingClientRect();
    if (!text || !r || !(e instanceof MouseEvent)) { setHover(null); return; }
    setHover({ text, x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  const engine = useMemo<Engine | null>(() => map && {
    kind: "google", map, hover: showHover,
    popup: (html, anchor) => {
      const c = document.createElement("div");
      c.innerHTML = html;
      info.current?.setContent(c);
      info.current?.open({ map, anchor });
    },
  }, [map, showHover]);

  return (
    <div ref={box} className="relative h-full w-full">
      <div ref={el} className="h-full w-full" />
      {engine && <EngineCtx.Provider value={engine}>{children}</EngineCtx.Provider>}
      {hover && (
        <div className="pointer-events-none absolute z-[700] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl bg-white px-2.5 py-1.5 text-xs font-semibold text-ink shadow-float"
          style={{ left: hover.x, top: hover.y - 12 }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

function MapBtn({ children, onClick, title }: { children: ReactNode; onClick: () => void; title: string }) {
  return (
    <button type="button" title={title} aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid h-[38px] w-[38px] place-items-center rounded-2xl bg-white text-ink shadow-soft hover:bg-canvas">
      {children}
    </button>
  );
}
