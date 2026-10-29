from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import HazardImage, MaintenanceTask, Notification, Status, User
from ..schemas import TaskUpdateIn
from ..security import require_roles
from ..services import incidents as svc
from ..services.realtime import manager
from .hazards import save_image

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])
staff = require_roles("maintenance", "operator")


def task_out(t: MaintenanceTask) -> dict:
    return {"id": t.id, "status": t.status, "priority": t.priority, "instructions": t.instructions,
            "resolution_notes": t.resolution_notes, "created_at": t.created_at, "updated_at": t.updated_at,
            "completed_at": t.completed_at, "assignee": {"id": t.assignee.id, "name": t.assignee.name},
            "completion_image_url": f"/uploads/{t.completion_image_path}" if t.completion_image_path else None,
            "incident": svc.serialize_incident(t.incident)}


def _task(db: Session, tid: int, user: User) -> MaintenanceTask:
    t = db.get(MaintenanceTask, tid)
    if not t or (user.role == "maintenance" and t.assigned_to != user.id):
        raise HTTPException(404, "Task not found")
    return t


@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db), user: User = Depends(staff)):
    q = select(MaintenanceTask).order_by(MaintenanceTask.created_at.desc())
    if user.role == "maintenance":
        q = q.where(MaintenanceTask.assigned_to == user.id)
    return [task_out(t) for t in db.scalars(q).all()]


@router.get("/tasks/{tid}")
def get_task(tid: int, db: Session = Depends(get_db), user: User = Depends(staff)):
    t = _task(db, tid, user)
    return {**task_out(t), "incident": svc.serialize_incident(t.incident, detail=True)}


@router.post("/tasks/{tid}/photo")
def upload_completion_photo(tid: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                            user: User = Depends(require_roles("maintenance"))):
    t = _task(db, tid, user)
    img = save_image(file, user, db, folder="completion")
    t.completion_image_path = img.storage_path
    db.commit()
    return {"url": f"/uploads/{img.storage_path}", "image_id": img.id}


@router.patch("/tasks/{tid}")
def update_task(tid: int, body: TaskUpdateIn, db: Session = Depends(get_db),
                user: User = Depends(require_roles("maintenance"))):
    """Maintenance can progress work and request clearance. They cannot resolve incidents or lift restrictions."""
    t = _task(db, tid, user)
    if t.status == "closed":
        raise HTTPException(409, "Task is already closed")
    inc = t.incident
    if body.resolution_notes is not None:
        t.resolution_notes = body.resolution_notes.strip()
    if body.completion_image_id:
        img = db.get(HazardImage, body.completion_image_id)
        if not img or img.uploader_id != user.id:
            raise HTTPException(404, "Image not found")
        t.completion_image_path = img.storage_path
    if body.status == "in_progress" and t.status == "assigned":
        t.status = "in_progress"
        if inc.verification_status == Status.VERIFIED:
            svc.transition(db, inc, user, Status.IN_PROGRESS, "work_started", f"{user.name} started work.")
    elif body.status == "awaiting_clearance":
        if not t.resolution_notes:
            raise HTTPException(422, "Add resolution notes before requesting clearance")
        t.status = "awaiting_clearance"
        t.completed_at = datetime.now(timezone.utc)
        if inc.verification_status in (Status.VERIFIED, Status.IN_PROGRESS):
            svc.transition(db, inc, user, Status.AWAITING_CLEARANCE, "clearance_requested",
                           f"{user.name}: {t.resolution_notes}")
        svc.notify_operators(db, inc, "Clearance requested",
                             f"{svc.CATEGORY_LABELS[inc.category]} near {inc.location_label} — work completed, "
                             f"awaiting review.", "high")
    elif body.status is not None and body.status != t.status:
        raise HTTPException(409, f"Cannot move task from {t.status} to {body.status}")
    db.commit()
    manager.publish("maintenance.task.updated", {"task_id": t.id, "incident_id": inc.id, "status": t.status})
    return task_out(t)


@router.get("/staff")
def maintenance_staff(db: Session = Depends(get_db), user: User = Depends(require_roles("operator"))):
    users = db.scalars(select(User).where(User.role == "maintenance")).all()
    open_counts = {}
    for t in db.scalars(select(MaintenanceTask).where(MaintenanceTask.status != "closed")):
        open_counts[t.assigned_to] = open_counts.get(t.assigned_to, 0) + 1
    return [{"id": u.id, "name": u.name, "open_tasks": open_counts.get(u.id, 0)} for u in users]
