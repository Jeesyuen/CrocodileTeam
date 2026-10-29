import clsx from "clsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, LocateFixed } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

export const PILOT_BOUNDS: L.LatLngBoundsExpression = [[2.905, 101.63], [2.935, 101.665]];
// Override with VITE_MAP_TILE_URL for production (OSM's public tiles are for light use only).
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined)
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const CENTER: [number, number] = [2.9230, 101.6440];
const inPilot = (lat: number, lon: number) => lat >= 2.905 && lat <= 2.935 && lon >= 101.63 && lon <= 101.665;

export function NavigationMap({ children, className, onMapClick, fitTo, fitKey, showLocate = true, overlay }: {
  children?: ReactNode; className?: string; onMapClick?: (lat: number, lon: number) => void;
  fitTo?: [number, number][] | null; fitKey?: string; showLocate?: boolean; overlay?: ReactNode;
}) {
  return (
    <div className={clsx("relative overflow-hidden rounded-4xl bg-line shadow-soft", className)}>
      <MapContainer center={CENTER} zoom={15} minZoom={13} maxZoom={19} zoomControl={false} className="h-full w-full"
        maxBounds={[[2.88, 101.6], [2.96, 101.7]]} maxBoundsViscosity={0.8}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        <ZoomControl />
        {onMapClick && <ClickHandler onClick={onMapClick} />}
        {fitTo && fitTo.length > 1 && <FitBounds points={fitTo} k={fitKey} />}
        <Controls showLocate={showLocate} />
        {children}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-2 left-3 z-[500] rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-muted shadow-soft">
        Demo map (OpenStreetMap) · routes by SafeRoute engine
      </div>
      {overlay}
    </div>
  );
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

const meIcon = L.divIcon({
  className: "sr-marker",
  html: `<div style="position:relative;width:22px;height:22px"><span style="position:absolute;inset:0;border-radius:999px;background:#7968C9;opacity:.35" class="animate-pulseRing"></span><span style="position:absolute;inset:4px;border-radius:999px;background:#7968C9;border:3px solid #fff;box-shadow:0 4px 10px rgba(121,104,201,.5)"></span></div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
});

function Controls({ showLocate }: { showLocate: boolean }) {
  const map = useMap();
  const [me, setMe] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const locate = () => {
    if (!navigator.geolocation) { setMsg("Location is not available in this browser"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: [number, number] = [p.coords.latitude, p.coords.longitude];
        if (!inPilot(...ll)) { setMsg("You're outside the Cyberjaya pilot area"); setTimeout(() => setMsg(null), 3500); return; }
        setMe(ll);
        map.flyTo(ll, 17);
      },
      () => { setMsg("Location permission denied"); setTimeout(() => setMsg(null), 3500); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };
  return (
    <>
      {me && <Marker position={me} icon={meIcon} />}
      <div className="leaflet-top leaflet-right" style={{ top: "auto", bottom: 96 }}>
        <div className="leaflet-control flex flex-col gap-2 !mr-[10px]">
          <MapBtn title="Recenter on Cyberjaya" onClick={() => map.flyToBounds(PILOT_BOUNDS, { duration: 0.6 })}><Crosshair size={18} /></MapBtn>
          {showLocate && <MapBtn title="My location" onClick={locate}><LocateFixed size={18} /></MapBtn>}
        </div>
      </div>
      {msg && <div className="absolute left-1/2 top-4 z-[600] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-xs font-semibold text-white">{msg}</div>}
    </>
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
