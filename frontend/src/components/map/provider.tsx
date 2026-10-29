import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { loadGoogleMaps, onGoogleAuthFailure } from "./google";

interface MapConfig { provider: "google" | "leaflet"; google: { browser_key: string; map_id: string } | null }

export interface MapProviderState {
  /** Which base map is rendered. Routes always come from the SafeRoute engine either way. */
  kind: "google" | "leaflet";
  ready: boolean;
  mapId: string;
  /** Set when Google Maps was configured but could not be used. */
  fallbackReason: string | null;
}

const initial: MapProviderState = { kind: "leaflet", ready: false, mapId: "", fallbackReason: null };
const Ctx = createContext<MapProviderState>(initial);
export const useMapProvider = () => useContext(Ctx);

export function MapProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<MapProviderState>(initial);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const fallback = (reason: string | null) => alive && setState({ kind: "leaflet", ready: true, mapId: "", fallbackReason: reason });
    const off = onGoogleAuthFailure(() => fallback("Google Maps rejected the API key"));
    api<MapConfig>("/api/map/config").then(async (cfg) => {
      if (cfg.provider !== "google" || !cfg.google) return fallback(null);
      try {
        await loadGoogleMaps(cfg.google.browser_key);
        if (alive) setState((s) => (s.fallbackReason ? s : { kind: "google", ready: true, mapId: cfg.google!.map_id, fallbackReason: null }));
      } catch {
        fallback("Google Maps could not be loaded");
      }
    }).catch(() => fallback(null));
    return () => { alive = false; off(); };
  }, [user]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
