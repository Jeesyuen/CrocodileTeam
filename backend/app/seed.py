"""Repeatable demo seed. Everything created here is SYNTHETIC demonstration data.

Hazards are placed exactly on real mapped OSM path segments; traffic history comes
from the synthetic generator in services/traffic_sim.py.

    python -m app.seed            # create tables + seed (trains the traffic model if missing)
    python -m app.seed --retrain  # also retrain the traffic model
"""
from __future__ import annotations

import random
import shutil
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import (
    HazardReport, Incident, IncidentHistory, MaintenanceTask, Notification, PathEdge, PathNode, Restriction, Status,
    TrafficModelVersion, TrafficObservation, User,
)
from .security import hash_password
from .services.graph import get_network, get_traffic_segments
from .services.incidents import CATEGORY_LABELS, DEFAULT_RELEVANCE, location_label, recompute_impacts
from .services.traffic_model import MODEL_VERSION, load_metrics, train
from .services.traffic_sim import MYT, has_incident, history_times, is_raining, speed_ratio

DEMO_PASSWORD = "demo1234"
SEED = 2026

USERS = [
    # (name, email, role, colour)
    ("Aisyah Rahman", "student.a@demo.saferoute.my", "student", "#E9E3FF"),
    ("Daniel Lim", "student.b@demo.saferoute.my", "student", "#DDF2F1"),
    ("Priya Nair", "priya@demo.saferoute.my", "student", "#E6F5FF"),
    ("Hafiz Azman", "hafiz@demo.saferoute.my", "student", "#FDEBD3"),
    ("Mei Ling Tan", "meiling@demo.saferoute.my", "student", "#E9E3FF"),
    ("Arjun Kumar", "arjun@demo.saferoute.my", "student", "#DDF2F1"),
    ("Nurul Izzah", "nurul@demo.saferoute.my", "student", "#E6F5FF"),
    ("Jason Wong", "jason@demo.saferoute.my", "student", "#FDEBD3"),
    ("Siti Aminah", "siti@demo.saferoute.my", "student", "#E9E3FF"),
    ("Kevin Ong", "kevin@demo.saferoute.my", "student", "#DDF2F1"),
    ("Farid Ismail", "driver@demo.saferoute.my", "driver", "#E6F5FF"),
    ("Grace Chua", "grace@demo.saferoute.my", "driver", "#FDEBD3"),
    ("Ravi Shankar", "ravi@demo.saferoute.my", "driver", "#E9E3FF"),
    ("Zainab Yusof", "zainab@demo.saferoute.my", "driver", "#DDF2F1"),
    ("Marcus Teo", "marcus@demo.saferoute.my", "driver", "#E6F5FF"),
    ("Puan Halimah", "operator@demo.saferoute.my", "operator", "#E9E3FF"),
    ("Encik Rizal", "rizal.ops@demo.saferoute.my", "operator", "#DDF2F1"),
    ("Ahmad Kamal", "maintenance@demo.saferoute.my", "maintenance", "#FDEBD3"),
    ("Lee Chong", "lee.maint@demo.saferoute.my", "maintenance", "#E6F5FF"),
    ("Muthu Raj", "muthu.maint@demo.saferoute.my", "maintenance", "#DDF2F1"),
]

DESCRIPTIONS = {
    "fallen_tree": ["Large branch fell across the walkway after the storm.", "Tree down blocking one lane.",
                    "Fallen tree partially blocking the footpath."],
    "flooding": ["Water pooling ankle-deep after heavy rain.", "Flash flood at the dip in the road, cars slowing.",
                 "Drain overflowing onto the pedestrian path."],
    "pothole": ["Deep pothole in the left lane.", "Several potholes near the junction.",
                "Pothole with sharp edges, risky for motorcycles."],
    "damaged_pavement": ["Broken paving slabs, easy to trip.", "Uneven pavement with exposed edges.",
                         "Cracked walkway near the bus stop."],
    "construction": ["Road works narrowing the lane.", "Construction hoarding blocking the footpath.",
                     "Utility works with temporary barriers."],
    "road_debris": ["Debris and gravel scattered across the lane.", "Fallen signboard lying on the road.",
                    "Construction debris on the shoulder."],
    "poor_lighting": ["Street lights not working along this stretch.", "Very dark walkway at night.",
                      "Two lamp posts out near the crossing."],
    "slippery_surface": ["Oil spill making the road slippery.", "Algae on the walkway, very slippery when wet.",
                         "Mud washed onto the path."],
    "road_accident": ["Two-car collision, one lane blocked.", "Motorcycle accident, emergency services on site.",
                      "Minor fender-bender causing slowdown."],
}
WALK_CATS = ["damaged_pavement", "poor_lighting", "slippery_surface", "fallen_tree", "flooding"]
DRIVE_CATS = ["pothole", "road_accident", "construction", "road_debris", "flooding", "fallen_tree"]

# (status, count, age range in hours, restriction)
PLAN = [
    (Status.PENDING, 6, (1, 40), Restriction.ADVISORY),
    (Status.EXPIRED, 2, (80, 110), Restriction.ADVISORY),
    (Status.VERIFIED, 5, (6, 60), Restriction.CAUTION),
    (Status.VERIFIED, 2, (4, 30), Restriction.CLOSED),
    (Status.IN_PROGRESS, 3, (20, 90), Restriction.CAUTION),
    (Status.AWAITING_CLEARANCE, 2, (30, 120), Restriction.CAUTION),
    (Status.RESOLVED, 12, (150, 700), Restriction.NONE),
    (Status.REJECTED, 2, (100, 400), Restriction.NONE),
]


def interpolate(geom, frac=0.5):
    from .services.graph import haversine
    lens = [haversine(a, b) for a, b in zip(geom, geom[1:])]
    target = sum(lens) * frac
    for (a, b), L in zip(zip(geom, geom[1:]), lens):
        if target <= L and L > 0:
            f = target / L
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
        target -= L
    return geom[-1][0], geom[-1][1]


def clear_operational(db: Session):
    db.execute(update(Incident).values(primary_report_id=None))
    skip = {"path_nodes", "path_edges", "traffic_observations", "traffic_predictions", "traffic_model_versions"}
    for table in reversed(Base.metadata.sorted_tables):
        if table.name not in skip:
            db.execute(table.delete())
    db.commit()
    up = get_settings().upload_dir
    for sub in ("hazards", "completion"):
        shutil.rmtree(up / sub, ignore_errors=True)


def seed_users(db: Session) -> list[User]:
    pw = hash_password(DEMO_PASSWORD)
    users = [User(id=i + 1, name=n, email=e, role=r, password_hash=pw, avatar_color=c)
             for i, (n, e, r, c) in enumerate(USERS)]
    db.add_all(users)
    db.commit()
    return users


def seed_network(db: Session):
    if db.scalar(select(PathEdge.id).limit(1)):
        return
    for mode in ("walk", "drive"):
        net = get_network(mode)
        db.execute(insert(PathNode), [{"id": k, "network": mode, "latitude": v[0], "longitude": v[1]}
                                      for k, v in net.nodes.items()])
        db.execute(insert(PathEdge), [{
            "id": e.id, "segment_id": e.seg, "source_node": e.u, "target_node": e.v, "geometry": e.geom,
            "distance": e.length, "transport_mode": mode, "road_class": e.highway, "name": e.name,
            "accessibility": {k: v for k, v in {"lit": e.lit, "surface": e.surface,
                                                 "wheelchair": e.attrs.get("wheelchair")}.items() if v},
            "restriction_status": "none", "traffic_segment_id": e.traffic_segment} for e in net.edges.values()])
    db.commit()


def seed_traffic(db: Session, days: int = 14):
    db.execute(TrafficObservation.__table__.delete())
    rows = []
    segs = get_traffic_segments()
    for t in history_times(datetime.now(MYT), days):
        rain = is_raining(t)
        for s in segs:
            inc = has_incident(s["id"], t)
            r = speed_ratio(s, t, rain=rain, incident=inc)
            sp = r * s["free_flow_kmh"]
            rows.append({"road_segment_id": s["id"], "timestamp": t, "average_speed": round(sp, 1),
                         "travel_time": round(s["length_m"] / (sp / 3.6), 1), "rain": rain, "incident": inc,
                         "data_source": "synthetic"})
    for i in range(0, len(rows), 5000):
        db.execute(insert(TrafficObservation), rows[i:i + 5000])
    db.commit()
    return len(rows)


def seed_model(db: Session, retrain: bool):
    metrics = load_metrics()
    if retrain or metrics is None:
        metrics = train()
    if not db.scalar(select(TrafficModelVersion.id).where(TrafficModelVersion.version == MODEL_VERSION)):
        db.add(TrafficModelVersion(model_name="RandomForestRegressor (vs historical-average baseline)",
                                   version=MODEL_VERSION, evaluation_metrics=metrics, data_source="synthetic"))
        db.commit()


def seed_hazards(db: Session, users: list[User]):
    rng = random.Random(SEED)
    now = datetime.now(timezone.utc)
    reporters = [u for u in users if u.role in ("student", "driver")]
    ops = [u for u in users if u.role == "operator"]
    crew = [u for u in users if u.role == "maintenance"]
    walk, drive = get_network("walk"), get_network("drive")
    walk_edges = [e for e in walk.edges.values() if e.highway in ("footway", "path", "pedestrian", "residential",
                                                                  "service", "cycleway") and e.length > 25]
    drive_edges = [e for e in drive.edges.values() if e.highway in ("primary", "secondary", "tertiary",
                                                                     "unclassified", "residential") and e.length > 40]
    placed: list[tuple[float, float]] = []

    def pick_location(cat):
        from .services.graph import haversine
        pool = walk_edges if DEFAULT_RELEVANCE[cat] == "walk" else (
            drive_edges if DEFAULT_RELEVANCE[cat] == "drive" else rng.choice([walk_edges, drive_edges]))
        for _ in range(200):
            e = rng.choice(pool)
            p = interpolate(e.geom, rng.uniform(0.3, 0.7))
            if all(haversine(p, q) > 120 for q in placed):
                placed.append(p)
                return p
        return interpolate(rng.choice(pool).geom)

    def hist(inc, action, actor, frm, to, note, at):
        db.add(IncidentHistory(incident_id=inc.id, action=action, actor_id=actor.id if actor else None,
                               from_status=frm, to_status=to, note=note, created_at=at))

    n = 0
    for status, count, (h0, h1), restriction in PLAN:
        for _ in range(count):
            n += 1
            cat = rng.choice(WALK_CATS + DRIVE_CATS)
            lat, lon = pick_location(cat)
            created = now - timedelta(hours=rng.uniform(h0, h1))
            sev = rng.choices(["low", "medium", "high", "critical"], [3, 5, 3, 1])[0]
            if restriction == Restriction.CLOSED:
                sev = rng.choice(["high", "critical"])
                cat = rng.choice(["fallen_tree", "flooding", "construction"])
            reporter = rng.choice(reporters)
            desc = rng.choice(DESCRIPTIONS[cat])
            obstruction = "complete" if restriction == Restriction.CLOSED else rng.choice(["none", "partial", "partial"])
            inc = Incident(category=cat, title=f"{CATEGORY_LABELS[cat]} reported", description=desc, severity=sev,
                           verification_status=status, restriction_status=restriction, obstruction=obstruction,
                           latitude=lat, longitude=lon, location_label=location_label(lat, lon),
                           mode_relevance=DEFAULT_RELEVANCE[cat], is_synthetic=True, created_at=created,
                           updated_at=created, report_count=1)
            db.add(inc)
            db.flush()
            rep = HazardReport(reporter_id=reporter.id, incident_id=inc.id, category=cat, description=desc,
                               latitude=lat, longitude=lon, severity=sev, obstruction=obstruction, status=status,
                               created_at=created)
            db.add(rep)
            db.flush()
            inc.primary_report_id = rep.id
            hist(inc, "submitted", reporter, None, Status.SUBMITTED, "Community report submitted (synthetic demo data).",
                 created)
            t = created + timedelta(minutes=rng.randint(1, 3))
            hist(inc, "queued", None, Status.SUBMITTED, Status.PENDING, "Awaiting operator verification.", t)
            op = rng.choice(ops)
            if status == Status.EXPIRED:
                hist(inc, "expired", None, Status.PENDING, Status.EXPIRED, "No verification within 72 h — review required.",
                     created + timedelta(hours=72))
            if status in (Status.VERIFIED, Status.IN_PROGRESS, Status.AWAITING_CLEARANCE, Status.RESOLVED):
                t = created + timedelta(minutes=rng.randint(15, 240))
                hist(inc, "verified", op, Status.PENDING, Status.VERIFIED,
                     "Closure confirmed." if restriction == Restriction.CLOSED else "Hazard verified.", t)
            if status in (Status.IN_PROGRESS, Status.AWAITING_CLEARANCE, Status.RESOLVED):
                worker = rng.choice(crew)
                t2 = t + timedelta(hours=rng.uniform(1, 6))
                task_status = {"in_progress": "in_progress", "awaiting_clearance": "awaiting_clearance",
                               "resolved": "closed"}[status]
                notes = "" if status == Status.IN_PROGRESS else rng.choice(
                    ["Debris cleared and area swept.", "Patched and compacted.", "Drain unblocked, water receded.",
                     "Replaced damaged slabs.", "Lamp replaced and tested."])
                done = t2 + timedelta(hours=rng.uniform(2, 20)) if notes else None
                db.add(MaintenanceTask(incident_id=inc.id, assigned_to=worker.id, assigned_by=op.id,
                                       status=task_status, priority=sev, resolution_notes=notes, created_at=t2,
                                       updated_at=done or t2, completed_at=done,
                                       instructions="Inspect and make safe."))
                hist(inc, "assigned", op, None, None, f"Assigned to {worker.name}.", t2)
                hist(inc, "work_started", worker, Status.VERIFIED, Status.IN_PROGRESS, f"{worker.name} started work.",
                     t2 + timedelta(minutes=30))
                if done:
                    hist(inc, "clearance_requested", worker, Status.IN_PROGRESS, Status.AWAITING_CLEARANCE,
                         f"{worker.name}: {notes}", done)
                if status == Status.RESOLVED:
                    rt = (done or t2) + timedelta(hours=rng.uniform(1, 8))
                    hist(inc, "resolved", op, Status.AWAITING_CLEARANCE, Status.RESOLVED,
                         "Resolution reviewed and accepted.", rt)
                    inc.resolved_at = rt
            if status == Status.REJECTED:
                hist(inc, "rejected", op, Status.PENDING, Status.REJECTED, "No hazard found on inspection.",
                     created + timedelta(hours=rng.uniform(2, 12)))
            recompute_impacts(db, inc)
    db.commit()
    return n


def run(retrain: bool = False, include_static: bool = True) -> dict:
    s = get_settings()
    s.upload_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        clear_operational(db)
        users = seed_users(db)
        stats = {"users": len(users)}
        if include_static:
            seed_network(db)
            stats["traffic_observations"] = seed_traffic(db)
            seed_model(db, retrain)
        stats["hazards"] = seed_hazards(db, users)
        db.add(Notification(user_id=users[15].id, kind="system", priority="low", title="Welcome to SafeRoute AI",
                            message="Demo data loaded. All hazards and traffic in this environment are synthetic."))
        db.commit()
    return stats


def ensure_seeded() -> dict:
    """Deployment start-up: seed only an empty database, so restarts keep real reports. Ensures the model exists."""
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)) is None:
            return run()
        seed_model(db, retrain=False)  # trains only if the model files are missing
    return {"skipped": "database already seeded"}


if __name__ == "__main__":
    print(ensure_seeded() if "--if-empty" in sys.argv else run(retrain="--retrain" in sys.argv))
