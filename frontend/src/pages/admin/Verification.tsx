import { MapPinned, Save } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HazardDetailPanel } from "@/components/HazardDetailPanel";
import { HazardReportCard } from "@/components/HazardReportCard";
import { NavigationMap } from "@/components/map/MapBase";
import { hazardIcon, pinIcon } from "@/components/map/layers";
import { MapMarker } from "@/components/map/primitives";
import { OperatorActions } from "@/components/OperatorActions";
import { EmptyState, ErrorNote, LoadingSkeleton, PageHeader } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Incident } from "@/lib/types";

export default function Verification() {
  const [params, setParams] = useSearchParams();
  const queue = useApi<Incident[]>("/api/hazards?status=submitted,pending_verification,expired_review");
  useRealtimeEvent(["hazard.", "demo.reset"], () => queue.reload(true));
  const items = queue.data ?? [];
  const sel = params.get("id") ? Number(params.get("id")) : items[0]?.id ?? null;
  const selInc = items.find((i) => i.id === sel);

  return (
    <div className="page">
      <PageHeader title="Incident verification" subtitle="Review community reports. AI analysis is advisory — your decision sets the official status." />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <section className="card card-pad lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto scroll-thin">
          <h2 className="mb-3 font-bold">Queue <span className="text-muted">· {items.length}</span></h2>
          {queue.loading && !queue.data ? <LoadingSkeleton rows={5} /> : items.length === 0 ? <EmptyState title="All caught up" text="New reports will appear here in real time." /> : (
            <div className="space-y-2.5">{items.map((i) => <HazardReportCard key={i.id} inc={i} selected={i.id === sel} onClick={() => setParams({ id: String(i.id) })} />)}</div>
          )}
        </section>
        <div className="space-y-6">
          {sel != null && selInc && <LocationCorrection inc={selInc} onSaved={() => queue.reload(true)} />}
          {sel != null && (
            <div className="rounded-4xl bg-white/50">
              <HazardDetailPanel key={sel} id={sel} onClose={() => setParams({})} actions={(d, r) => <OperatorActions d={d} reload={() => { r(); queue.reload(true); }} />} />
            </div>
          )}
          {sel == null && !queue.loading && <div className="card"><EmptyState title="Select a report" /></div>}
        </div>
      </div>
    </div>
  );
}

function LocationCorrection({ inc, onSaved }: { inc: Incident; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!pin) return;
    try {
      await api(`/api/hazards/${inc.id}/impact`, { method: "PATCH", body: { lat: pin[0], lon: pin[1], note: "Location corrected during verification" } });
      setEditing(false); setPin(null); onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save location"); }
  };
  return (
    <section className="card card-pad">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-bold"><MapPinned size={17} />Location</h3>
          <p className="text-sm text-muted">Match: <b>{inc.match_quality}</b>. {inc.match_quality === "none" ? "Not linked to a mapped path — move the pin onto the road or walkway." : "Hazards must be linked to real path segments to affect routing."}</p>
        </div>
        {!editing ? <button className="btn-soft !py-2" onClick={() => setEditing(true)}>Correct location</button> : (
          <div className="flex gap-2"><button className="btn-ghost !py-2" onClick={() => { setEditing(false); setPin(null); }}>Cancel</button>
            <button className="btn-primary !py-2" disabled={!pin} onClick={save}><Save size={15} />Save</button></div>
        )}
      </div>
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      {editing && (
        <NavigationMap className="mt-4 h-72" fitTo={[[inc.lat - 0.0015, inc.lon - 0.0015], [inc.lat + 0.0015, inc.lon + 0.0015]]} fitKey={String(inc.id)} onMapClick={(a, b) => setPin([a, b])} showLocate={false}>
          <MapMarker position={[inc.lat, inc.lon]} icon={hazardIcon(inc)} opacity={0.6} />
          {pin && <MapMarker position={pin} icon={pinIcon} />}
        </NavigationMap>
      )}
    </section>
  );
}
