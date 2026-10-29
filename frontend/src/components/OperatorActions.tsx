import clsx from "clsx";
import { Ban, CheckCircle2, GitMerge, LockOpen, Lock, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, assetUrl } from "@/lib/api";
import { haversine } from "@/lib/geo";
import { SEVERITY } from "@/lib/meta";
import type { Incident, IncidentDetail, Severity, Task } from "@/lib/types";
import { ConfirmationDialog, ErrorNote, Segmented } from "./ui";

type Action = null | "verify" | "reject" | "merge" | "assign" | "resolve" | "clear" | "restrict";

export function OperatorActions({ d, reload }: { d: IncidentDetail; reload: () => void }) {
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<Severity>(d.severity);
  const [restriction, setRestriction] = useState<"caution" | "closed">(d.obstruction === "complete" ? "closed" : "caution");
  const [targetId, setTargetId] = useState<number | null>(null);
  const [nearby, setNearby] = useState<Incident[]>([]);
  const [staff, setStaff] = useState<{ id: number; name: string; open_tasks: number }[]>([]);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [instructions, setInstructions] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => { setSeverity(d.severity); }, [d.severity]);
  useEffect(() => {
    api<Task[]>("/api/maintenance/tasks").then((all) => setTasks(all.filter((t) => t.incident.id === d.id))).catch(() => {});
  }, [d.id, d.status]);
  useEffect(() => {
    if (action === "merge") {
      api<Incident[]>("/api/hazards?state=active").then((all) =>
        setNearby(all.filter((i) => i.id !== d.id).map((i) => ({ ...i, _d: haversine([d.lat, d.lon], [i.lat, i.lon]) }))
          .sort((a, b) => a._d - b._d).slice(0, 8))).catch(() => {});
    }
    if (action === "assign") api<typeof staff>("/api/maintenance/staff").then((s) => { setStaff(s); setAssignee(s[0]?.id ?? null); }).catch(() => {});
  }, [action, d.id, d.lat, d.lon]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setAction(null); setNote(""); reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Action failed"); }
    finally { setBusy(false); }
  };

  const pending = ["submitted", "pending_verification", "expired_review"].includes(d.status);
  const working = ["verified_active", "in_progress", "awaiting_clearance"].includes(d.status);
  const openTask = tasks.find((t) => t.status !== "closed");

  return (
    <div>
      <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-lavender-deep" /><h3 className="font-bold">Operator actions</h3></div>
      {openTask && (
        <div className="mt-3 rounded-2xl bg-sky p-3 text-sm">
          <div className="font-semibold">Maintenance: {openTask.assignee.name} · {openTask.status.replace("_", " ")}</div>
          {openTask.resolution_notes && <p className="mt-1 text-ink/80">“{openTask.resolution_notes}”</p>}
          {openTask.completion_image_url && <img src={assetUrl(openTask.completion_image_url)} alt="Completion evidence" className="mt-2 max-h-40 rounded-xl object-cover" />}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {pending && <button className="btn-primary !py-2" onClick={() => setAction("verify")}><CheckCircle2 size={15} />Verify</button>}
        {pending && <button className="btn-danger !py-2" onClick={() => setAction("reject")}><Ban size={15} />Reject</button>}
        {(pending || working) && <button className="btn-outline !py-2" onClick={() => setAction("merge")}><GitMerge size={15} />Merge duplicate</button>}
        {working && <button className="btn-soft !py-2" onClick={() => setAction("restrict")}><Lock size={15} />Severity / restriction</button>}
        {working && !openTask && <button className="btn-soft !py-2" onClick={() => setAction("assign")}><UserPlus size={15} />Assign maintenance</button>}
        {working && <button className="btn-mint !py-2" onClick={() => setAction("resolve")}><CheckCircle2 size={15} />{d.status === "awaiting_clearance" ? "Accept & resolve" : "Resolve"}</button>}
        {d.restriction !== "none" && !pending && <button className="btn-outline !py-2" onClick={() => setAction("clear")}><LockOpen size={15} />Reopen path</button>}
      </div>
      {d.status === "resolved" && d.restriction === "closed" && (
        <p className="mt-3 rounded-2xl bg-peach px-3 py-2 text-xs text-[#9A6418]">Resolved, but the path is still closed. Closures are never reopened automatically — reopen it once it's safe.</p>
      )}
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}

      <ConfirmationDialog open={action === "verify"} title="Verify hazard" confirmLabel={restriction === "closed" ? "Verify & close path" : "Verify"} busy={busy}
        onClose={() => setAction(null)} onConfirm={() => run(() => api(`/api/hazards/${d.id}/verify`, { body: { severity, restriction, note } }))}>
        <div className="space-y-4">
          <div><div className="label mb-1.5">Severity</div>
            <Segmented value={severity} onChange={setSeverity} options={(Object.keys(SEVERITY) as Severity[]).map((s) => ({ value: s, label: SEVERITY[s].label }))} /></div>
          <div><div className="label mb-1.5">Path restriction</div>
            <Segmented value={restriction} onChange={setRestriction} options={[{ value: "caution", label: "Open — caution" }, { value: "closed", label: "Confirm closure" }]} />
            <p className="mt-1.5 text-xs text-muted">{restriction === "closed" ? "Routing will exclude the linked path segments until you reopen them." : "Routes stay open but carry a verified hazard warning."}</p>
            {restriction === "closed" && d.match_quality === "none" && <p className="mt-1 text-xs text-[#C4444E]">This pin is not linked to a mapped path — correct the location first.</p>}
          </div>
          <textarea className="input min-h-[70px]" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog open={action === "reject"} title="Reject report" text="Mark this as a false or unfounded report. Its routing warning is removed." confirmLabel="Reject" danger busy={busy}
        onClose={() => setAction(null)} onConfirm={() => run(() => api(`/api/hazards/${d.id}/reject`, { body: { note } }))}>
        <textarea className="input mt-3 min-h-[70px]" placeholder="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmationDialog>

      <ConfirmationDialog open={action === "merge"} title="Merge into another incident" confirmLabel="Merge" busy={busy || !targetId}
        onClose={() => setAction(null)} onConfirm={() => targetId && run(() => api(`/api/hazards/${d.id}/merge`, { body: { target_id: targetId, note } }))}>
        <p className="text-sm text-muted">Choose the incident this report duplicates. Nearest active incidents:</p>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto scroll-thin">
          {nearby.map((i) => (
            <button key={i.id} onClick={() => setTargetId(i.id)}
              className={clsx("flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm ring-1", targetId === i.id ? "bg-lavender ring-lavender-deep" : "ring-line hover:bg-canvas")}>
              <span><b>#{i.id}</b> {i.category_label} · {i.location_label}</span>
              <span className="text-xs text-muted">{Math.round((i as Incident & { _d: number })._d)} m</span>
            </button>
          ))}
        </div>
      </ConfirmationDialog>

      <RestrictDialog open={action === "restrict"} d={d} busy={busy} onClose={() => setAction(null)}
        onSave={(body) => run(() => api(`/api/hazards/${d.id}/impact`, { method: "PATCH", body }))} />

      <ConfirmationDialog open={action === "assign"} title="Assign maintenance" confirmLabel="Assign task" busy={busy || !assignee}
        onClose={() => setAction(null)} onConfirm={() => assignee && run(() => api(`/api/hazards/${d.id}/assign`, { body: { assignee_id: assignee, instructions, priority: d.severity } }))}>
        <div className="space-y-2">
          {staff.map((s) => (
            <button key={s.id} onClick={() => setAssignee(s.id)}
              className={clsx("flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm ring-1", assignee === s.id ? "bg-lavender ring-lavender-deep" : "ring-line hover:bg-canvas")}>
              <span className="font-semibold">{s.name}</span><span className="text-xs text-muted">{s.open_tasks} open task{s.open_tasks === 1 ? "" : "s"}</span>
            </button>
          ))}
          <textarea className="input min-h-[70px]" placeholder="Instructions (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog open={action === "resolve"} title="Resolve incident" confirmLabel="Resolve" busy={busy}
        text={d.restriction === "closed" ? "The incident will be marked resolved. The path stays closed until you reopen it." : "Marks the incident resolved and removes its routing warning."}
        onClose={() => setAction(null)} onConfirm={() => run(() => api(`/api/hazards/${d.id}/resolve`, { body: { note } }))}>
        <textarea className="input mt-3 min-h-[70px]" placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmationDialog>

      <ConfirmationDialog open={action === "clear"} title="Reopen path" confirmLabel="Reopen path" busy={busy}
        text="Removes the restriction from the linked path segments. Routes may use them again immediately."
        onClose={() => setAction(null)} onConfirm={() => run(() => api(`/api/hazards/${d.id}/clear`, { body: { note } }))} />
    </div>
  );
}

function RestrictDialog({ open, d, busy, onClose, onSave }: {
  open: boolean; d: IncidentDetail; busy: boolean; onClose: () => void; onSave: (b: object) => void;
}) {
  const [sev, setSev] = useState<Severity>(d.severity);
  const [res, setRes] = useState<"advisory" | "caution" | "closed">(d.restriction === "none" ? "caution" : (d.restriction as "caution"));
  useEffect(() => { setSev(d.severity); if (d.restriction !== "none") setRes(d.restriction as "caution"); }, [d, open]);
  return (
    <ConfirmationDialog open={open} title="Severity & restriction" confirmLabel="Save" busy={busy} onClose={onClose}
      onConfirm={() => onSave({ severity: sev !== d.severity ? sev : undefined, restriction: res !== d.restriction ? res : undefined })}>
      <div className="space-y-4">
        <div><div className="label mb-1.5">Severity</div><Segmented value={sev} onChange={setSev} options={(Object.keys(SEVERITY) as Severity[]).map((s) => ({ value: s, label: SEVERITY[s].label }))} /></div>
        <div><div className="label mb-1.5">Restriction</div><Segmented value={res} onChange={setRes} options={[{ value: "advisory", label: "Warning" }, { value: "caution", label: "Caution" }, { value: "closed", label: "Closed" }]} /></div>
      </div>
    </ConfirmationDialog>
  );
}
