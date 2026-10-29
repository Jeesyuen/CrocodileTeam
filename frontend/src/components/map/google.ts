/** Loads the Google Maps JavaScript API once (maps, marker and places libraries). */

declare global {
  interface Window { __srGoogleReady?: () => void; gm_authFailure?: () => void }
}

let pending: Promise<typeof google.maps> | null = null;
const authListeners = new Set<() => void>();

/** Google calls `gm_authFailure` when the key is rejected (bad key, referrer not allowed, API disabled). */
export function onGoogleAuthFailure(fn: () => void) {
  authListeners.add(fn);
  return () => { authListeners.delete(fn); };
}

export function loadGoogleMaps(key: string): Promise<typeof google.maps> {
  if (pending) return pending;
  pending = new Promise<typeof google.maps>((resolve, reject) => {
    window.gm_authFailure = () => authListeners.forEach((f) => f());
    window.__srGoogleReady = async () => {
      try {
        await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker"), google.maps.importLibrary("places")]);
        resolve(google.maps);
      } catch (e) { reject(e); }
    };
    const s = document.createElement("script");
    const q = new URLSearchParams({ key, v: "weekly", loading: "async", libraries: "marker,places", callback: "__srGoogleReady", region: "MY" });
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
    s.async = true;
    s.onerror = () => { pending = null; s.remove(); reject(new Error("Could not reach Google Maps")); };
    document.head.appendChild(s);
  });
  return pending;
}

export const toLL = (p: [number, number]): google.maps.LatLngLiteral => ({ lat: p[0], lng: p[1] });

export function readPosition(p: google.maps.LatLng | google.maps.LatLngLiteral | google.maps.LatLngAltitudeLiteral | null | undefined): [number, number] | null {
  if (!p) return null;
  return typeof p.lat === "function" ? [(p as google.maps.LatLng).lat(), (p as google.maps.LatLng).lng()] : [p.lat as number, p.lng as number];
}

export const PILOT_LITERAL = { south: 2.905, west: 101.63, north: 2.935, east: 101.665 };

/* ---------- Places API (New) autocomplete, restricted to the pilot area ---------- */

export interface GoogleSuggestion { id: string; title: string; subtitle: string; prediction: google.maps.places.PlacePrediction }
/** One token per search session (typing → one selection), as Google bills per session. */
export interface SessionRef { current: google.maps.places.AutocompleteSessionToken | null }

export async function suggestPlaces(input: string, session: SessionRef): Promise<GoogleSuggestion[]> {
  session.current ??= new google.maps.places.AutocompleteSessionToken();
  const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input, sessionToken: session.current, locationRestriction: PILOT_LITERAL, includedRegionCodes: ["my"], region: "my",
  });
  return suggestions.flatMap((s) => {
    const p = s.placePrediction;
    return p ? [{ id: p.placeId, title: p.mainText?.text ?? p.text.text, subtitle: p.secondaryText?.text ?? "", prediction: p }] : [];
  });
}

export async function resolvePlace(s: GoogleSuggestion, session: SessionRef) {
  const place = s.prediction.toPlace();
  await place.fetchFields({ fields: ["location", "displayName"] });
  session.current = null; // fetchFields ends the session
  const ll = readPosition(place.location);
  if (!ll) throw new Error("Google did not return a location for this place");
  return { lat: ll[0], lon: ll[1], label: place.displayName || s.title };
}
