import clsx from "clsx";
import { ArrowLeft, Camera, CheckCircle2, Loader2, Navigation2, Play } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LifecycleStepper } from "@/components/HazardDetailPanel";
import { HazardThumb } from "@/components/HazardReportCard";
import { NavigationMap } from "@/components/map/MapBase";
import { hazardIcon } from "@/components/map/layers";
import { MapMarker, MapPolyline } from "@/components/map/primitives";
import { CertaintyBadge, ErrorNote, LoadingSkeleton, SeverityBadge } from "@/components/ui";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { api, ApiError, assetUrl } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { IncidentDetail, Task } from "@/lib/types";
import { TASK_STATUS } from "./Tasks";

export default function TaskDetail() {
  const { id } = useParams();
  const { data: t, error, loading, reload, setData } = useApi<Task & { incident: IncidentDetail }>(`/api/maintenance/tasks/${id}`);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useRealtimeEvent(["maintenance.", "hazard."], () => reload(true));

  if (loading && !t) return <div className="page"><LoadingSkeleton rows={4} /></div>;
  if (error || !t) return <div className="page"><ErrorNote message={error ?? "Task not found"} /></div>;
  const inc = t.incident;
  const n = notes ?? t.resolution_notes;

  const update = async (body: object) => {
    setBusy(true); setErr(null);
    try { const r = await api<Task>(`/api/maintenance/tasks/${t.id}`, { method: "PATCH", body }); setData({ ...t, ...r, incident: t.incident }); reload(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Update failed"); }
    finally { setBusy(false); }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const form = new FormData(); form.append("file", f);
      await api(`/api/maintenance/tasks/${t.id}/photo`, { form });
      reload(true);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="page max-w-5xl">
      <Link to="/tasks" className="btn-ghost mb-3 !px-2"><ArrowLeft size={16} />All tasks</Link>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <section className="card overflow-hidden">
            {inc.images[0] ? <img src={assetUrl(inc.images[0])} alt="Reported hazard" className="max-h-64 w-full object-cover" /> : <HazardThumb inc={inc} className="h-36 w-full" />}
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="mr-auto text-xl font-extrabold">{inc.category_label}</h1>
                <SeverityBadge s={t.priority} /><span className={clsx("chip", TASK_STATUS[t.status].cls)}>{TASK_STATUS[t.status].label}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{inc.location_label} · reported {fmtDateTime(inc.created_at)}</p>
              <p className="mt-3">{inc.description}</p>
              <div className="mt-3 flex gap-2"><CertaintyBadge c={inc.certainty} /></div>
              {t.instructions && <p className="mt-3 rounded-2xl bg-canvas px-3 py-2 text-sm"><b>Instructions:</b> {t.instructions}</p>}
              <LifecycleStepper status={inc.status} />
            </div>
          </section>
          <NavigationMap className="h-72" fitTo={[[inc.lat, inc.lon], ...inc.affected_paths.flatMap((a) => a.geometry)]} fitKey={String(inc.id)}>
            {inc.affected_paths.map((a, i) => <MapPolyline key={i} positions={a.geometry} color={a.impact_type === "closure" ? "#E2545E" : "#F4B860"} weight={7} />)}
            <MapMarker position={[inc.lat, inc.lon]} icon={hazardIcon(inc, true)} />
          </NavigationMap>
          <a className="btn-outline w-full" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/directions?to=${inc.lat}%2C${inc.lon}`}><Navigation2 size={16} />Directions to site</a>
        </div>

        <section className="card card-pad h-fit space-y-5 lg:sticky lg:top-20">
          <h2 className="text-lg font-bold">Work progress</h2>
          {err && <ErrorNote message={err} />}
          {t.status === "assigned" && <button className="btn-primary w-full !py-3" disabled={busy} onClick={() => update({ status: "in_progress" })}><Play size={16} />Start work</button>}
          {t.status !== "assigned" && (
            <>
              <div>
                <div className="label mb-1.5">Completion photo</div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                {t.completion_image_url ? (
                  <img src={assetUrl(t.completion_image_url)} alt="Completion evidence" className="max-h-56 w-full rounded-3xl object-cover" />
                ) : (
                  <button disabled={busy || t.status === "closed"} onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-line bg-canvas py-8 text-sm font-semibold text-muted hover:bg-white">
                    {busy ? <Loader2 className="animate-spin" /> : <Camera size={22} />}Upload evidence photo
                  </button>
                )}
              </div>
              <label className="block"><span className="label">Resolution notes</span>
                <textarea className="input mt-1.5 min-h-[110px]" value={n} disabled={t.status === "closed"} onChange={(e) => setNotes(e.target.value)} placeholder="What was done? e.g. Tree cut and removed, path swept." /></label>
              {t.status === "in_progress" && (
                <button className="btn-primary w-full !py-3" disabled={busy || !n.trim()} onClick={() => update({ status: "awaiting_clearance", resolution_notes: n })}>
                  <CheckCircle2 size={16} />Request clearance
                </button>
              )}
              {t.status === "awaiting_clearance" && (
                <div className="rounded-3xl bg-lavender p-4 text-sm">
                  <b>Clearance requested.</b> A safety operator will review your evidence. Only operators can resolve the incident or reopen a closed path.
                  {notes !== null && notes !== t.resolution_notes && <button className="btn-soft mt-3 !py-1.5" onClick={() => update({ resolution_notes: n })}>Update notes</button>}
                </div>
              )}
              {t.status === "closed" && <div className="rounded-3xl bg-mint p-4 text-sm"><b>Task closed.</b> The operator accepted this work.</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
