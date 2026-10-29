import clsx from "clsx";
import { Building2, GraduationCap, Hospital, MapPin, MousePointerClick, Search, ShoppingBag, Trees, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GoogleSuggestion, resolvePlace, SessionRef, suggestPlaces } from "@/components/map/google";
import { useMapProvider } from "@/components/map/provider";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import type { LatLon, Place } from "@/lib/types";

const kindIcon = (k: string) =>
  k === "university" || k === "college" || k === "school" ? GraduationCap
    : k === "hospital" || k === "clinic" ? Hospital
      : k === "park" ? Trees
        : k === "mall" || k === "supermarket" ? ShoppingBag : Building2;
const inPilot = (lat: number, lon: number) => lat >= 2.905 && lat <= 2.935 && lon >= 101.63 && lon <= 101.665;

type Item = { key: string; title: string; subtitle: string; kind: string; source: "google" | "osm"; pick: () => Promise<void> | void };

export function LocationSelector({ value, onChange, placeholder, dot, onPickOnMap, picking }: {
  value: LatLon | null; onChange: (p: LatLon | null) => void; placeholder: string; dot: string;
  onPickOnMap?: () => void; picking?: boolean;
}) {
  const [q, setQ] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Place[]>([]);
  const [gItems, setGItems] = useState<GoogleSuggestion[]>([]);
  const [gError, setGError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 180);
  const box = useRef<HTMLDivElement>(null);
  const google = useMapProvider().kind === "google";
  const session = useRef<SessionRef["current"]>(null);

  useEffect(() => { setQ(value?.label ?? (value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : "")); }, [value]);
  useEffect(() => {
    if (!open) return;
    api<Place[]>(`/api/places?q=${encodeURIComponent(dq)}&limit=${google && dq ? 4 : 8}`).then((r) => { setItems(r); setActive(0); }).catch(() => setItems([]));
  }, [dq, open, google]);
  useEffect(() => {
    if (!open || !google || dq.trim().length < 2 || dq === value?.label) { setGItems([]); return; }
    let alive = true;
    suggestPlaces(dq, session).then((r) => { if (alive) { setGItems(r.slice(0, 5)); setGError(null); setActive(0); } })
      .catch(() => { if (alive) { setGItems([]); setGError("Google Places search is unavailable"); } });
    return () => { alive = false; };
  }, [dq, open, google, value?.label]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const choose = (p: Place) => {
    onChange({ lat: p.lat, lon: p.lon, label: p.name });
    setOpen(false);
  };
  const chooseGoogle = async (g: GoogleSuggestion) => {
    try {
      const r = await resolvePlace(g, session);
      if (!inPilot(r.lat, r.lon)) { setGError(`${r.label} is outside the Cyberjaya pilot area`); return; }
      onChange(r);
      setOpen(false);
    } catch {
      setGError("Could not get that place's location from Google");
    }
  };
  const list: Item[] = [
    ...gItems.map((g): Item => ({ key: `g${g.id}`, title: g.title, subtitle: g.subtitle, kind: "place", source: "google", pick: () => chooseGoogle(g) })),
    ...items.map((p): Item => ({ key: `o${p.id}`, title: p.name, subtitle: `${p.kind.replace("_", " ")} · Cyberjaya`, kind: p.kind, source: "osm", pick: () => choose(p) })),
  ];

  return (
    <div ref={box} className="relative">
      <div className={clsx("flex items-center gap-2 rounded-2xl bg-canvas px-3 ring-1 transition", picking ? "ring-2 ring-lavender-deep" : "ring-line focus-within:bg-white focus-within:ring-2 focus-within:ring-lavender-deep/40")}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
        <input
          className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted"
          placeholder={picking ? "Click a point on the map…" : placeholder} value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { setActive((a) => Math.min(a + 1, list.length - 1)); e.preventDefault(); }
            if (e.key === "ArrowUp") { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
            if (e.key === "Enter" && list[active]) { list[active].pick(); e.preventDefault(); }
            if (e.key === "Escape") setOpen(false);
          }}
          aria-label={placeholder}
        />
        {value && <button className="text-muted hover:text-ink" onClick={() => { onChange(null); setQ(""); }} aria-label="Clear"><X size={16} /></button>}
        {onPickOnMap && (
          <button title="Pick on map" aria-label="Pick on map" onClick={onPickOnMap}
            className={clsx("grid h-8 w-8 place-items-center rounded-xl transition", picking ? "bg-lavender-deep text-white" : "text-muted hover:bg-lavender hover:text-lavender-deep")}>
            <MousePointerClick size={16} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[900] mt-2 overflow-hidden rounded-3xl bg-white p-2 shadow-float animate-rise">
          {!q && <div className="px-3 pb-1 pt-2 label">Popular in Cyberjaya</div>}
          {gError && <div className="px-3 py-2 text-xs font-semibold text-[#C4444E]">{gError}</div>}
          {list.length === 0 && <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted"><Search size={15} /> No places in the pilot area match "{q}"</div>}
          {list.map((it, i) => {
            const Icon = it.source === "google" ? MapPin : kindIcon(it.kind);
            return (
              <button key={it.key} onMouseEnter={() => setActive(i)} onClick={() => it.pick()}
                className={clsx("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left", i === active && "bg-canvas")}>
                <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", it.source === "google" ? "bg-sky text-sky-deep" : "bg-lavender-soft text-lavender-deep")}><Icon size={16} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{it.title}</span>
                  <span className={clsx("block truncate text-xs text-muted", it.source === "osm" && "capitalize")}>{it.subtitle}</span>
                </span>
              </button>
            );
          })}
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] text-muted">
            <MapPin size={11} /> {google ? "Places from Google and OpenStreetMap" : "Places from OpenStreetMap"}
          </div>
        </div>
      )}
    </div>
  );
}
