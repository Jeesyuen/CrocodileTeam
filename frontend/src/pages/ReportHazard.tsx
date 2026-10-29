import clsx from "clsx";
import { Bot, Camera, Check, CheckCircle2, Footprints, Car, ImagePlus, Loader2, MapPin, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NavigationMap } from "@/components/map/MapBase";
import { pinIcon } from "@/components/map/layers";
import { MapMarker } from "@/components/map/primitives";
import { AIInsightCard, ErrorNote, PageHeader, Segmented } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { CATEGORIES, SEVERITY } from "@/lib/meta";
import type { AIResult, IncidentDetail, Severity } from "@/lib/types";

interface Match { matches: Record<string, null | { road: string | null; distance_m: number; quality: string; highway: string }>; location_label: string }
type Obstruction = "none" | "partial" | "complete" | "unknown";

export default function ReportHazard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageId, setImageId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ai, setAi] = useState<AIResult | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [severity, setSeverity] = useState<Severity>("medium");
  const [obstruction, setObstruction] = useState<Obstruction>("unknown");
  const [relevance, setRelevance] = useState<"auto" | "walk" | "drive" | "both">("auto");
  const [description, setDescription] = useState("");
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ incident: IncidentDetail; merged: boolean } | null>(null);
  const dpin = useDebounced(pin, 250);

  useEffect(() => {
    if (!dpin) { setMatch(null); return; }
    const rel = relevance === "auto" ? "both" : relevance;
    api<Match>(`/api/map/match?lat=${dpin[0]}&lon=${dpin[1]}&relevance=${rel}`).then(setMatch).catch(() => setMatch(null));
  }, [dpin, relevance]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setAi(null); setAiApplied(false);
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setError("Please choose a JPEG, PNG or WEBP photo."); return; }
    if (f.size > 8 * 1024 * 1024) { setError("Photo is larger than 8 MB."); return; }
    setPreview(URL.createObjectURL(f));
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const up = await api<{ image_id: number }>("/api/hazards/images", { form });
      setImageId(up.image_id);
      const res = await api<AIResult>("/api/hazards/analyze-image", { body: { image_id: up.image_id } });
      setAi(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
      setPreview(null); setImageId(null);
    } finally { setUploading(false); }
  };

  const applyAI = () => {
    if (!ai?.result) return;
    setCategory(ai.result.hazard_type);
    setSeverity(ai.result.severity);
    setObstruction(ai.result.possible_blockage as Obstruction);
    if (ai.result.affects === "pedestrians") setRelevance("walk");
    else if (ai.result.affects === "vehicles") setRelevance("drive");
    else if (ai.result.affects === "both") setRelevance("both");
    if (!description) setDescription(ai.result.description);
    setAiApplied(true);
  };

  const removePhoto = () => { setPreview(null); setImageId(null); setAi(null); setAiApplied(false); if (fileRef.current) fileRef.current.value = ""; };

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setPin([p.coords.latitude, p.coords.longitude]),
      () => setError("Location permission denied — tap the map to place the pin instead."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submit = async () => {
    if (!category || !pin) return;
    setSubmitting(true); setError(null);
    try {
      const r = await api<{ incident: IncidentDetail; merged_into_existing: boolean }>("/api/hazards", {
        body: { category, severity, description, lat: pin[0], lon: pin[1], obstruction, image_ids: imageId ? [imageId] : [],
          mode_relevance: relevance === "auto" ? null : relevance, ai_suggestion_used: aiApplied },
      });
      setDone({ incident: r.incident, merged: r.merged_into_existing });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit the report");
    } finally { setSubmitting(false); }
  };

  const reset = () => {
    removePhoto(); setCategory(null); setSeverity("medium"); setObstruction("unknown"); setRelevance("auto");
    setDescription(""); setPin(null); setDone(null); setError(null);
  };

  if (done) {
    return (
      <div className="page max-w-2xl">
        <div className="card p-8 text-center animate-rise">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-mint text-mint-deep"><CheckCircle2 size={32} /></span>
          <h1 className="mt-4 text-2xl font-extrabold">{done.merged ? "Added to an existing report" : "Report submitted"}</h1>
          <p className="mt-2 text-muted">
            {done.merged
              ? `A matching ${done.incident.category_label.toLowerCase()} was already reported nearby (#${done.incident.id}). Your report strengthens it — ${done.incident.report_count} reports so far.`
              : `Thanks! Hazard #${done.incident.id} is now on the map as an unverified report. Nearby travellers on affected paths are being alerted, and a safety operator will review it.`}
          </p>
          {done.incident.match_quality === "none" && <p className="mt-2 text-sm text-[#9A6418]">Your pin isn't on a mapped path, so it won't affect routing until an operator corrects the location.</p>}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to={`/hazards?id=${done.incident.id}`} className="btn-primary">View on map</Link>
            <Link to="/my-reports" className="btn-soft">My reports</Link>
            <button onClick={reset} className="btn-outline"><RotateCcw size={15} />Report another</button>
          </div>
        </div>
      </div>
    );
  }

  const m = match?.matches;
  const best = m ? Object.entries(m).filter(([, v]) => v).sort((a, b) => a[1]!.distance_m - b[1]!.distance_m) : [];

  return (
    <div className="page max-w-6xl">
      <PageHeader title="Report a hazard" subtitle="Photo, pin, category — about 30 seconds. AI suggestions are optional and you can always correct them." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* 1 photo */}
          <section className="card card-pad">
            <Step n={1} title="Add a photo" hint="Optional but helps verification" />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            {!preview ? (
              <button onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-lavender-deep/30 bg-lavender-soft py-10 text-lavender-deep transition hover:bg-lavender">
                <span className="grid h-14 w-14 place-items-center rounded-3xl bg-white shadow-soft"><Camera size={26} /></span>
                <span className="font-bold">Take or upload a photo</span>
                <span className="text-xs text-muted">JPEG, PNG or WEBP · up to 8 MB · location metadata is stripped</span>
              </button>
            ) : (
              <div className="relative overflow-hidden rounded-3xl">
                <img src={preview} alt="Hazard preview" className="max-h-72 w-full object-cover" />
                <div className="absolute right-3 top-3 flex gap-2">
                  <button onClick={() => fileRef.current?.click()} className="btn bg-white/90 !p-2" aria-label="Replace photo"><ImagePlus size={16} /></button>
                  <button onClick={removePhoto} className="btn bg-white/90 !p-2" aria-label="Remove photo"><Trash2 size={16} /></button>
                </div>
                {uploading && <div className="absolute inset-0 grid place-items-center bg-white/60 text-sm font-semibold"><span className="flex items-center gap-2"><Loader2 className="animate-spin" size={18} />Analysing photo…</span></div>}
              </div>
            )}
            {ai && (
              <div className="mt-4">
                {ai.result ? (
                  <AIInsightCard title={ai.status === "uncertain" ? "AI suggestion · low confidence" : "AI suggestion"} footer={
                    <button className={aiApplied ? "btn-mint !py-2" : "btn-primary !py-2"} onClick={applyAI} disabled={aiApplied}>
                      {aiApplied ? <><Check size={15} />Applied — review below</> : <><Sparkles size={15} />Apply suggestion</>}
                    </button>}>
                    <p><b>{CATEGORIES.find((c) => c.id === ai.result!.hazard_type)?.label}</b> · {SEVERITY[ai.result.severity].label} severity · blockage: {ai.result.possible_blockage} · {Math.round(ai.result.confidence * 100)}% confidence</p>
                    <p className="text-sm text-ink/70">{ai.result.description}</p>
                    <p className="text-xs text-muted">{ai.message} Only a safety operator can confirm closures.</p>
                  </AIInsightCard>
                ) : (
                  <div className="flex items-start gap-3 rounded-3xl bg-canvas p-4 text-sm ring-1 ring-line">
                    <Bot size={18} className="mt-0.5 shrink-0 text-muted" /><span className="text-muted">{ai.message}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2 category */}
          <section className="card card-pad">
            <Step n={2} title="What did you see?" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)}
                  className={clsx("flex flex-col items-center gap-1.5 rounded-3xl p-3 text-center text-xs font-semibold ring-1 transition",
                    category === c.id ? "ring-2 shadow-soft" : "ring-line hover:bg-canvas")}
                  style={category === c.id ? { background: c.bg, color: c.color, ["--tw-ring-color" as string]: c.color } : undefined}>
                  <span className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: c.bg }}><c.icon size={19} color={c.color} /></span>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><div className="label mb-1.5">Severity</div>
                <Segmented value={severity} onChange={setSeverity} className="w-full justify-between"
                  options={(Object.keys(SEVERITY) as Severity[]).map((s) => ({ value: s, label: SEVERITY[s].label }))} /></div>
              <div><div className="label mb-1.5">Is the path blocked?</div>
                <Segmented value={obstruction} onChange={setObstruction} className="w-full justify-between"
                  options={[{ value: "none", label: "No" }, { value: "partial", label: "Partly" }, { value: "complete", label: "Fully" }, { value: "unknown", label: "Unsure" }]} /></div>
            </div>
            <div className="mt-4"><div className="label mb-1.5">Who does it affect?</div>
              <Segmented value={relevance} onChange={setRelevance}
                options={[{ value: "auto", label: "Auto" }, { value: "walk", label: <span className="flex items-center gap-1"><Footprints size={13} />Walkers</span> },
                  { value: "drive", label: <span className="flex items-center gap-1"><Car size={13} />Drivers</span> }, { value: "both", label: "Both" }]} /></div>
            <label className="mt-4 block"><span className="label">Description (optional)</span>
              <textarea className="input mt-1.5 min-h-[84px] resize-none" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Large branch blocking the walkway beside the lake" /></label>
          </section>
        </div>

        {/* 3 location */}
        <div className="space-y-6">
          <section className="card card-pad lg:sticky lg:top-20">
            <Step n={3} title="Where is it?" hint="Tap the map to place or move the pin" />
            <NavigationMap className="h-[340px] sm:h-[400px]" onMapClick={(lat, lon) => setPin([lat, lon])}>
              {pin && <MapMarker position={pin} icon={pinIcon} draggable onDragEnd={(lat, lon) => setPin([lat, lon])} />}
            </NavigationMap>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn-soft !py-2" onClick={useMyLocation}><MapPin size={15} />Use my location</button>
              {pin && <span className="text-xs text-muted">{pin[0].toFixed(5)}, {pin[1].toFixed(5)}</span>}
            </div>
            {pin && match && (
              <div className={clsx("mt-3 rounded-3xl p-4 text-sm", best.length ? "bg-mint" : "bg-peach")}>
                {best.length ? (
                  <>
                    <div className="font-semibold">Linked to {best[0][1]!.road ?? "a mapped path"} <span className="font-normal text-muted">({best[0][1]!.distance_m} m · {best[0][1]!.quality} match)</span></div>
                    <div className="mt-0.5 text-xs text-muted">Routes using this {best.map(([k]) => (k === "walk" ? "footpath" : "road")).join(" and ")} will see a warning.</div>
                  </>
                ) : (
                  <div><b>Not on a mapped path.</b> <span className="text-muted">Move the pin onto the road or walkway so the report can affect routing (within 25 m).</span></div>
                )}
              </div>
            )}
            {error && <div className="mt-4"><ErrorNote message={error} /></div>}
            <button className="btn-primary mt-5 w-full !py-3.5 text-base" disabled={!category || !pin || submitting || uploading} onClick={submit}>
              {submitting ? <><Loader2 size={18} className="animate-spin" />Submitting…</> : "Submit report"}
            </button>
            {(!category || !pin) && <p className="mt-2 text-center text-xs text-muted">{!category ? "Choose a category" : "Place the pin on the map"} to submit.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-lavender text-sm font-extrabold text-lavender-deep">{n}</span>
      <div><h2 className="font-bold leading-tight">{title}</h2>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
    </div>
  );
}
