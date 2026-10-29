from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import RouteSession, User
from ..schemas import CompareIn, SessionIn
from ..security import get_current_user
from ..services.planner import plan
from ..services.routing import RoutingError

router = APIRouter(prefix="/api/routes", tags=["routing"])


def run_plan(db, **kw):
    try:
        return plan(db, **kw)
    except RoutingError as e:
        raise HTTPException(422 if e.code in ("outside_area", "same_point") else 409,
                            {"code": e.code, "message": str(e)})


@router.post("/compare")
def compare(body: CompareIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return run_plan(db, mode=body.mode, origin=(body.origin.lat, body.origin.lon),
                    destination=(body.destination.lat, body.destination.lon), depart=body.depart_at,
                    weather=body.weather)


def session_out(s: RouteSession) -> dict:
    return {"id": s.id, "mode": s.mode, "preference": s.preference, "origin": s.origin, "destination": s.destination,
            "edge_ids": s.active_edge_ids, "segment_ids": s.active_segment_ids, "active": s.active,
            "created_at": s.created_at, "updated_at": s.updated_at}


@router.post("/sessions", status_code=201)
def start_session(body: SessionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.execute(update(RouteSession).where(RouteSession.user_id == user.id, RouteSession.active.is_(True))
               .values(active=False))
    s = RouteSession(user_id=user.id, mode=body.mode, preference=body.preference,
                     origin=body.origin.model_dump(), destination=body.destination.model_dump(),
                     active_edge_ids=body.edge_ids, active_segment_ids=body.segment_ids)
    db.add(s)
    db.commit()
    return session_out(s)


@router.get("/sessions/active")
def active_session(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.scalar(select(RouteSession).where(RouteSession.user_id == user.id, RouteSession.active.is_(True))
                  .order_by(RouteSession.id.desc()))
    return session_out(s) if s else None


@router.post("/sessions/{sid}/end")
def end_session(sid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(RouteSession, sid)
    if not s or s.user_id != user.id:
        raise HTTPException(404, "Session not found")
    s.active = False
    db.commit()
    return {"ok": True}


class RecalcIn(BaseModel):
    session_id: int


@router.post("/recalculate")
def recalculate(body: RecalcIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(RouteSession, body.session_id)
    if not s or s.user_id != user.id or not s.active:
        raise HTTPException(404, "Active session not found")
    result = run_plan(db, mode=s.mode, origin=(s.origin["lat"], s.origin["lon"]),
                      destination=(s.destination["lat"], s.destination["lon"]))
    chosen = next((r for r in result["routes"] if r["preference"] == s.preference), result["routes"][0])
    changed = chosen["edge_ids"] != s.active_edge_ids
    s.active_edge_ids, s.active_segment_ids = chosen["edge_ids"], chosen["segment_ids"]
    db.commit()
    return {"changed": changed, "route": chosen, "result": result, "session": session_out(s)}
