import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import AIAnalysis, HazardImage, HazardReport, Incident, MaintenanceTask, Restriction, Status, User
from ..schemas import AnalyzeIn, AssignIn, HazardIn, ImpactIn, MergeIn, NoteIn, VerifyIn, check_lat, check_lon
from ..security import get_current_user, report_limiter, require_roles
from ..services import incidents as svc
from ..services.ai_vision import analyze_image
from ..services.realtime import manager

router = APIRouter(prefix="/api/hazards", tags=["hazards"])
operator = require_roles("operator")
ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _get(db: Session, hid: int) -> Incident:
    inc = db.get(Incident, hid)
    if not inc:
        raise HTTPException(404, "Hazard not found")
    return inc


def save_image(file: UploadFile, user: User, db: Session, folder: str = "hazards") -> HazardImage:
    s = get_settings()
    raw = file.file.read(s.max_upload_mb * 1024 * 1024 + 1)
    if not raw:
        raise HTTPException(400, "No image provided")
    if len(raw) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Image is larger than {s.max_upload_mb} MB")
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "Unsupported or corrupted image. Use JPEG, PNG or WEBP.")
    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(415, "Unsupported image format. Use JPEG, PNG or WEBP.")
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    img.thumbnail((1600, 1600))
    # Re-encoding drops EXIF metadata (including any embedded GPS) — data minimisation.
    name = f"{folder}/{uuid.uuid4().hex}.jpg"
    path = s.upload_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=85)
    rec = HazardImage(uploader_id=user.id, storage_path=name, media_type="image/jpeg")
    db.add(rec)
    db.commit()
    return rec


@router.get("")
def list_hazards(
    category: str | None = None, severity: str | None = None, status: str | None = None,
    state: str | None = Query(None, pattern="^(active|resolved|all)$"), mode: str | None = None,
    days: int | None = Query(None, ge=1, le=365), mine: bool = False, paths: bool = False,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    svc.expire_stale(db)
    q = select(Incident).order_by(Incident.created_at.desc())
    if category:
        q = q.where(Incident.category.in_(category.split(",")))
    if severity:
        q = q.where(Incident.severity.in_(severity.split(",")))
    if status:
        q = q.where(Incident.verification_status.in_(status.split(",")))
    if state == "active":
        q = q.where(Incident.verification_status.in_(Status.ACTIVE))
    elif state == "resolved":
        q = q.where(Incident.verification_status == Status.RESOLVED)
    if mode in ("walk", "drive"):
        q = q.where(Incident.mode_relevance.in_([mode, "both"]))
    if days:
        q = q.where(Incident.created_at >= datetime.now(timezone.utc) - timedelta(days=days))
    if mine:
        q = q.where(Incident.id.in_(select(HazardReport.incident_id).where(HazardReport.reporter_id == user.id)))
    if user.role not in ("operator",):
        # community view hides reports an operator rejected as false, unless they are your own
        own = select(HazardReport.incident_id).where(HazardReport.reporter_id == user.id)
        q = q.where((Incident.verification_status != Status.REJECTED) | Incident.id.in_(own))
    out = []
    for i in db.scalars(q).unique().all():
        d = svc.serialize_incident(i)
        if paths:  # active affected road/path segments, for drawing closures and cautions on route maps
            d["affected_paths"] = svc.incident_paths(i, active_only=True, network=mode if mode in ("walk", "drive") else None)
        out.append(d)
    return out


@router.get("/mine")
def my_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    reports = db.scalars(select(HazardReport).where(HazardReport.reporter_id == user.id)
                         .order_by(HazardReport.created_at.desc())).all()
    out = []
    for r in reports:
        inc = r.incident
        out.append({"report_id": r.id, "created_at": r.created_at, "category": r.category, "severity": r.severity,
                    "description": r.description, "merged": r.status == Status.DUPLICATE and inc and inc.primary_report_id != r.id,
                    "images": [f"/uploads/{i.storage_path}" for i in r.images],
                    "incident": svc.serialize_incident(inc, detail=True) if inc else None})
    return out


@router.post("/images")
def upload_image(file: UploadFile = File(...), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    rec = save_image(file, user, db)
    return {"image_id": rec.id, "url": f"/uploads/{rec.storage_path}"}


@router.post("/analyze-image")
def analyze_uploaded(body: AnalyzeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    img = db.get(HazardImage, body.image_id)
    if not img or img.uploader_id != user.id:
        raise HTTPException(404, "Image not found")
    return _run_analysis(db, img)


def _run_analysis(db: Session, img: HazardImage, report_id: int | None = None) -> dict:
    data = (get_settings().upload_dir / img.storage_path).read_bytes()
    res = analyze_image(data, img.media_type)
    out = res["result"] or {}
    db.add(AIAnalysis(report_id=report_id or img.report_id, image_id=img.id, model_name=res["model"] or "none",
                      status=res["status"], classification=out.get("hazard_type"), confidence=out.get("confidence"),
                      output=res))
    db.commit()
    return res


@router.post("", status_code=201)
def create_hazard(body: HazardIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    report_limiter.check(f"user:{user.id}")
    inc, merged = svc.create_report(
        db, user, category=body.category, severity=body.severity, description=body.description.strip(),
        lat=body.lat, lon=body.lon, obstruction=body.obstruction, relevance=body.mode_relevance,
        image_ids=body.image_ids, ai_used=body.ai_suggestion_used)
    return {"incident": svc.serialize_incident(inc, detail=True), "merged_into_existing": merged}


@router.get("/{hid}")
def get_hazard(hid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return svc.serialize_incident(_get(db, hid), detail=True)


@router.post("/{hid}/analyze")
def reanalyze(hid: int, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc = _get(db, hid)
    img = next((i for r in inc.reports for i in r.images), None)
    if not img:
        raise HTTPException(400, "This hazard has no photo to analyse")
    return _run_analysis(db, img)


@router.post("/{hid}/verify")
def verify(hid: int, body: VerifyIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc = _get(db, hid)
    if inc.verification_status not in (Status.SUBMITTED, Status.PENDING, Status.EXPIRED):
        raise HTTPException(409, f"Cannot verify an incident that is {inc.verification_status}")
    if body.severity:
        inc.severity = body.severity
    restriction = Restriction.CLOSED if body.restriction == "closed" else Restriction.CAUTION
    if restriction == Restriction.CLOSED and inc.match_quality == "none":
        raise HTTPException(422, "Cannot confirm a closure: the location is not linked to a mapped path. "
                                 "Correct the location first.")
    note = body.note or ("Closure confirmed." if restriction == Restriction.CLOSED else "Hazard verified.")
    svc.transition(db, inc, user, Status.VERIFIED, "verified", note, restriction=restriction, reason="verified")
    return svc.serialize_incident(inc, detail=True)


@router.post("/{hid}/reject")
def reject(hid: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc = _get(db, hid)
    if inc.verification_status in Status.CLOSED:
        raise HTTPException(409, "Incident is already closed")
    svc.transition(db, inc, user, Status.REJECTED, "rejected", body.note or "Rejected as a false report.",
                   restriction=Restriction.NONE, reason="updated")
    return svc.serialize_incident(inc, detail=True)


@router.post("/{hid}/merge")
def merge(hid: int, body: MergeIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc, target = _get(db, hid), _get(db, body.target_id)
    if inc.id == target.id:
        raise HTTPException(400, "Cannot merge an incident into itself")
    if target.verification_status in Status.CLOSED:
        raise HTTPException(409, "Target incident is closed")
    for r in list(inc.reports):
        r.incident_id = target.id
        r.status = Status.DUPLICATE
    target.report_count += inc.report_count
    svc.log_history(db, target, "merged", user, note=f"Incident #{inc.id} merged into this incident.")
    svc.transition(db, inc, user, Status.DUPLICATE, "merged", body.note or f"Duplicate of #{target.id}.",
                   restriction=Restriction.NONE, reason="updated")
    db.refresh(target)
    svc.publish_incident("hazard.updated", target)
    return svc.serialize_incident(target, detail=True)


@router.patch("/{hid}/impact")
def update_impact(hid: int, body: ImpactIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc = _get(db, hid)
    changes = []
    if body.lat is not None and body.lon is not None:
        inc.latitude, inc.longitude = check_lat(body.lat), check_lon(body.lon)
        inc.location_label = svc.location_label(inc.latitude, inc.longitude)
        changes.append("location corrected")
    if body.mode_relevance:
        inc.mode_relevance = body.mode_relevance
        changes.append(f"relevance → {body.mode_relevance}")
    if body.severity:
        inc.severity = body.severity
        changes.append(f"severity → {body.severity}")
    if body.restriction:
        if body.restriction == Restriction.CLOSED and inc.verification_status in (Status.SUBMITTED, Status.PENDING,
                                                                                  Status.EXPIRED):
            raise HTTPException(409, "Verify the incident before confirming a closure")
        if body.restriction == Restriction.CLOSED and inc.match_quality == "none" and not changes:
            raise HTTPException(422, "Location is not linked to a mapped path")
        inc.restriction_status = body.restriction
        changes.append(f"restriction → {body.restriction}")
    if not changes:
        raise HTTPException(400, "Nothing to update")
    svc.log_history(db, inc, "impact_updated", user, note="; ".join(changes) + (f". {body.note}" if body.note else ""))
    svc.recompute_impacts(db, inc)
    db.flush()
    db.refresh(inc)
    if body.restriction == Restriction.CLOSED and inc.match_quality == "none":
        db.rollback()
        raise HTTPException(422, "Corrected location still does not match a mapped path")
    svc.notify_affected_sessions(db, inc, "updated")
    db.commit()
    db.refresh(inc)
    svc.publish_incident("hazard.updated", inc)
    return svc.serialize_incident(inc, detail=True)


@router.post("/{hid}/assign")
def assign(hid: int, body: AssignIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc = _get(db, hid)
    if inc.verification_status not in (Status.VERIFIED, Status.IN_PROGRESS, Status.EXPIRED):
        raise HTTPException(409, "Only verified incidents can be assigned to maintenance")
    assignee = db.get(User, body.assignee_id)
    if not assignee or assignee.role != "maintenance":
        raise HTTPException(400, "Assignee must be a maintenance user")
    task = MaintenanceTask(incident_id=inc.id, assigned_to=assignee.id, assigned_by=user.id, priority=body.priority,
                           instructions=body.instructions)
    db.add(task)
    svc.log_history(db, inc, "assigned", user, note=f"Assigned to {assignee.name}.")
    db.flush()
    from ..models import Notification
    n = Notification(user_id=assignee.id, incident_id=inc.id, kind="task.assigned", priority=body.priority,
                     title="New maintenance task", message=f"{svc.CATEGORY_LABELS[inc.category]} near "
                     f"{inc.location_label}. {body.instructions}".strip(), data={"task_id": task.id})
    db.add(n)
    db.commit()
    manager.publish("maintenance.task.updated", {"task_id": task.id, "incident_id": inc.id}, [assignee.id, user.id])
    manager.publish("notification.created", {"notification": svc.serialize_notification(n)}, [assignee.id])
    svc.publish_incident("hazard.updated", inc)
    return {"task_id": task.id}


@router.post("/{hid}/resolve")
def resolve(hid: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    inc = _get(db, hid)
    if inc.verification_status in Status.CLOSED:
        raise HTTPException(409, "Incident is already closed")
    for t in db.scalars(select(MaintenanceTask).where(MaintenanceTask.incident_id == inc.id,
                                                      MaintenanceTask.status != "closed")):
        t.status = "closed"
    note = body.note or "Resolution reviewed and accepted."
    if inc.restriction_status == Restriction.CLOSED:
        note += " Path remains closed until an operator reopens it."
        svc.transition(db, inc, user, Status.RESOLVED, "resolved", note, reason="resolved")
    else:
        svc.transition(db, inc, user, Status.RESOLVED, "resolved", note, restriction=Restriction.NONE,
                       reason="resolved")
    return svc.serialize_incident(inc, detail=True)


@router.post("/{hid}/clear")
def clear(hid: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(operator)):
    """Operator reopens a path. Never happens automatically."""
    inc = _get(db, hid)
    if inc.restriction_status == Restriction.NONE:
        raise HTTPException(409, "There is no restriction to clear")
    old = inc.restriction_status
    inc.restriction_status = Restriction.NONE
    svc.log_history(db, inc, "path_reopened", user, note=body.note or f"Restriction '{old}' lifted; path reopened.")
    svc.recompute_impacts(db, inc)
    db.commit()
    db.refresh(inc)
    svc.publish_incident("hazard.updated", inc)
    return svc.serialize_incident(inc, detail=True)
