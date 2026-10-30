import io
import json
from types import SimpleNamespace

from PIL import Image

from app.services import ai_vision
from app.services.graph import get_network
from app.services.incidents import match_location

from .conftest import HOSPITAL, MALL, MMU


def _walk_route(client, h, pref="balanced"):
    r = client.post("/api/routes/compare", headers=h, json={"mode": "walk", "origin": MMU, "destination": MALL})
    assert r.status_code == 200, r.text
    return r.json(), next(x for x in r.json()["routes"] if x["preference"] == pref)


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 140, 90)).save(buf, "PNG")
    return buf.getvalue()


# --- authentication & permissions -------------------------------------------------------------

def test_login_and_me(client, users):
    me = client.get("/api/auth/me", headers=users["a"]).json()
    assert me["role"] == "student"
    assert client.post("/api/auth/login", json={"email": "student.a@demo.saferoute.my", "password": "x"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_role_permissions(client, users):
    assert client.get("/api/dashboard/analytics", headers=users["a"]).status_code == 403
    assert client.get("/api/dashboard/analytics", headers=users["op"]).status_code == 200
    assert client.get("/api/maintenance/tasks", headers=users["a"]).status_code == 403
    assert client.post("/api/admin/reset-demo", headers=users["maint"]).status_code == 403


# --- geospatial matching & routing ------------------------------------------------------------

def test_path_matching_quality():
    e = next(e for e in get_network("walk").edges.values() if e.highway == "footway" and e.length > 30)
    mid = e.geom[len(e.geom) // 2]
    m = match_location(mid[0], mid[1], "walk")
    assert m["walk"]["quality"] == "reliable"
    # a point in open ground far from any mapped path does not match
    lat, lon = mid[0] + 0.003, mid[1] + 0.003
    far = match_location(lat, lon, "walk")
    if far["walk"]:
        assert far["walk"]["distance_m"] <= 25


def test_route_generation_follows_network(client, users):
    data, r = _walk_route(client, users["b"])
    net = get_network("walk")
    edges = [net.edges[i] for i in r["edge_ids"]]
    assert all(a.v == b.u for a, b in zip(edges, edges[1:])), "route must be a connected edge path"
    assert r["distance_m"] > 500 and 0 <= r["safety"]["score"] <= 100
    assert {x["preference"] for x in data["routes"]} == {"fastest", "safest", "balanced"}


def test_outside_pilot_area_rejected(client, users):
    r = client.post("/api/routes/compare", headers=users["b"],
                    json={"mode": "walk", "origin": {"lat": 3.15, "lon": 101.7}, "destination": MALL})
    assert r.status_code == 422


# --- hazards, AI fallback, duplicates ---------------------------------------------------------

def test_image_upload_and_ai_fallback(client, users):
    up = client.post("/api/hazards/images", headers=users["a"], files={"file": ("x.png", _png(), "image/png")})
    assert up.status_code == 200, up.text
    res = client.post("/api/hazards/analyze-image", headers=users["a"], json={"image_id": up.json()["image_id"]}).json()
    assert res["status"] == "unavailable" and res["result"] is None
    bad = client.post("/api/hazards/images", headers=users["a"], files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 415


def test_ai_invalid_output_is_rejected(monkeypatch):
    class FakeMessages:
        def create(self, **kw):
            return SimpleNamespace(stop_reason="end_turn", model="claude-opus-5-5",
                                   content=[SimpleNamespace(type="text", text=json.dumps({"hazard_type": "volcano"}))])
    monkeypatch.setattr(ai_vision, "get_settings", lambda: SimpleNamespace(anthropic_api_key="k", vision_model="m",
                                                                          vision_timeout_seconds=5))
    monkeypatch.setattr(ai_vision.anthropic, "Anthropic",
                        lambda **kw: SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages())))
    assert ai_vision.analyze_image(b"x", "image/jpeg")["status"] == "error"


def test_ai_valid_output_parsed(monkeypatch):
    out = {"is_hazard_photo": True, "hazard_type": "fallen_tree", "severity": "high", "possible_blockage": "complete",
           "affects": "pedestrians", "description": "A fallen tree blocks a walkway.", "confidence": 0.87,
           "requires_verification": False}

    class FakeMessages:
        def create(self, **kw):
            return SimpleNamespace(stop_reason="end_turn", model="claude-opus-5-5",
                                   content=[SimpleNamespace(type="text", text=json.dumps(out))])
    monkeypatch.setattr(ai_vision, "get_settings", lambda: SimpleNamespace(anthropic_api_key="k", vision_model="m",
                                                                          vision_timeout_seconds=5))
    monkeypatch.setattr(ai_vision.anthropic, "Anthropic",
                        lambda **kw: SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages())))
    res = ai_vision.analyze_image(b"x", "image/jpeg")
    assert res["status"] == "ok" and res["result"]["hazard_type"] == "fallen_tree"
    assert res["result"]["requires_verification"] is True  # forced for high severity


def test_hazard_submission_and_duplicate_detection(client, users):
    _, r = _walk_route(client, users["b"], "fastest")
    p = r["geometry"][len(r["geometry"]) // 3]
    body = {"category": "slippery_surface", "severity": "medium", "lat": p[0], "lon": p[1], "description": "Oil"}
    first = client.post("/api/hazards", headers=users["a"], json=body)
    assert first.status_code == 201 and first.json()["merged_into_existing"] is False
    inc = first.json()["incident"]
    assert inc["status"] == "pending_verification" and inc["certainty"] == "reported"
    dup = client.post("/api/hazards", headers=users["b"], json={**body, "lat": p[0] + 0.0001})
    assert dup.json()["merged_into_existing"] is True and dup.json()["incident"]["id"] == inc["id"]
    mine = client.get("/api/hazards/mine", headers=users["a"]).json()
    assert any(m["incident"]["id"] == inc["id"] for m in mine)
    listed = client.get("/api/hazards?state=active", headers=users["a"]).json()
    assert any(h["id"] == inc["id"] for h in listed)


# --- live safety: alerts, closures, rerouting, lifecycle --------------------------------------

def test_live_alert_closure_and_full_lifecycle(client, users):
    _, route = _walk_route(client, users["b"])
    s = client.post("/api/routes/sessions", headers=users["b"], json={
        "mode": "walk", "preference": "balanced", "origin": MMU, "destination": MALL,
        "edge_ids": route["edge_ids"], "segment_ids": route["segment_ids"]}).json()
    g = route["geometry"][len(route["geometry"]) // 2]
    token = users["b"]["Authorization"][7:]
    with client.websocket_connect(f"/ws/alerts?token={token}") as ws:
        assert ws.receive_json()["event"] == "connected"
        h = client.post("/api/hazards", headers=users["a"], json={
            "category": "fallen_tree", "severity": "high", "lat": g[0], "lon": g[1], "obstruction": "complete"})
        assert h.status_code == 201
        msg = ws.receive_json()
        assert msg["event"] == "route.affected"
        assert msg["data"]["notification"]["priority"] == "high"
        alt = msg["data"]["alternative"]
    hid = h.json()["incident"]["id"]
    impacted = {i["segment_id"] for i in h.json()["incident"]["impacts"] if i["network"] == "walk"}
    assert alt is None or not impacted & set(alt["segment_ids"])

    # duplicate alert suppression: re-running notification for the same state sends nothing new
    n_before = client.get("/api/notifications", headers=users["b"]).json()["unread"]

    # students cannot verify; operator confirms closure
    assert client.post(f"/api/hazards/{hid}/verify", headers=users["a"], json={"restriction": "closed"}).status_code == 403
    v = client.post(f"/api/hazards/{hid}/verify", headers=users["op"], json={"restriction": "closed"})
    assert v.status_code == 200 and v.json()["certainty"] == "confirmed_closure"
    assert client.get("/api/notifications", headers=users["b"]).json()["unread"] >= n_before

    # the community list exposes the closed path geometry for route maps
    listed = client.get("/api/hazards?state=active&mode=walk&paths=true", headers=users["b"]).json()
    mine = next(i for i in listed if i["id"] == hid)
    assert mine["affected_paths"] and all(p["impact_type"] == "closure" and len(p["geometry"]) >= 2
                                          for p in mine["affected_paths"])

    # routing avoids the confirmed closure
    data, _ = _walk_route(client, users["b"])
    assert all(not impacted & set(r["segment_ids"]) for r in data["routes"])

    # recalculate keeps the session off the closed segment
    rc = client.post("/api/routes/recalculate", headers=users["b"], json={"session_id": s["id"]}).json()
    assert not impacted & set(rc["route"]["segment_ids"])

    # maintenance workflow
    staff = client.get("/api/maintenance/staff", headers=users["op"]).json()
    me = client.get("/api/auth/me", headers=users["maint"]).json()
    assert client.post(f"/api/hazards/{hid}/assign", headers=users["op"],
                       json={"assignee_id": me["id"], "priority": "high"}).status_code == 200
    assert any(x["id"] == me["id"] for x in staff)
    task = next(t for t in client.get("/api/maintenance/tasks", headers=users["maint"]).json() if t["incident"]["id"] == hid)
    assert client.patch(f"/api/maintenance/tasks/{task['id']}", headers=users["maint"],
                        json={"status": "awaiting_clearance"}).status_code == 422  # notes required
    assert client.patch(f"/api/maintenance/tasks/{task['id']}", headers=users["maint"],
                        json={"status": "in_progress"}).status_code == 200
    assert client.patch(f"/api/maintenance/tasks/{task['id']}", headers=users["maint"],
                        json={"status": "awaiting_clearance", "resolution_notes": "Tree removed"}).status_code == 200
    assert client.get(f"/api/hazards/{hid}", headers=users["a"]).json()["status"] == "awaiting_clearance"
    # maintenance cannot reopen the path
    assert client.post(f"/api/hazards/{hid}/clear", headers=users["maint"], json={}).status_code == 403

    # operator resolves: closure persists until explicitly reopened
    r = client.post(f"/api/hazards/{hid}/resolve", headers=users["op"], json={}).json()
    assert r["status"] == "resolved" and r["restriction"] == "closed"
    data, _ = _walk_route(client, users["b"])
    assert all(not impacted & set(x["segment_ids"]) for x in data["routes"])
    c = client.post(f"/api/hazards/{hid}/clear", headers=users["op"], json={}).json()
    assert c["restriction"] == "none" and not any(i["active"] for i in c["impacts"])
    actions = [x["action"] for x in client.get(f"/api/hazards/{hid}", headers=users["op"]).json()["history"]]
    for a in ("submitted", "verified", "assigned", "work_started", "clearance_requested", "resolved", "path_reopened"):
        assert a in actions


def test_reject_and_merge(client, users):
    e = next(e for e in get_network("drive").edges.values() if e.highway == "tertiary" and e.length > 60)
    p = e.geom[len(e.geom) // 2]
    a = client.post("/api/hazards", headers=users["driver"], json={"category": "pothole", "severity": "low",
                                                                   "lat": p[0], "lon": p[1]}).json()["incident"]
    b = client.post("/api/hazards", headers=users["a"], json={"category": "road_debris", "severity": "low",
                                                              "lat": p[0], "lon": p[1]}).json()["incident"]
    m = client.post(f"/api/hazards/{b['id']}/merge", headers=users["op"], json={"target_id": a["id"]})
    assert m.status_code == 200 and m.json()["report_count"] == 2
    assert client.get(f"/api/hazards/{b['id']}", headers=users["op"]).json()["status"] == "duplicate"
    r = client.post(f"/api/hazards/{a['id']}/reject", headers=users["op"], json={"note": "Not found"})
    assert r.json()["status"] == "rejected"


# --- traffic AI -------------------------------------------------------------------------------

def test_traffic_forecast_labelled_and_responds_to_inputs(client, users):
    clear = client.get("/api/traffic/forecast?weather=clear", headers=users["driver"]).json()
    rain = client.get("/api/traffic/forecast?weather=rain", headers=users["driver"]).json()
    assert clear["data_source"]["type"] == "synthetic"
    assert len(clear["segments"]) == 27
    avg = lambda d: sum(s["forecasts"][2]["ratio"] for s in d["segments"]) / len(d["segments"])
    assert avg(rain) < avg(clear), "rain should lower predicted speeds"
    assert {f["horizon_min"] for f in clear["segments"][0]["forecasts"]} >= {15, 30, 60}


def test_traffic_predict_and_best_departure(client, users):
    p = client.post("/api/traffic/predict", headers=users["driver"],
                    json={"origin": MMU, "destination": HOSPITAL, "weather": "clear"})
    assert p.status_code == 200, p.text
    j = p.json()
    assert j["usual"] is not None and len(j["timeline"]) == 13 and j["insights"]
    assert all(t["usual_s"] and t["usual_s"] >= t["duration_s"] - 1 for t in j["timeline"])
    b = client.post("/api/traffic/best-departure", headers=users["driver"],
                    json={"origin": MMU, "destination": HOSPITAL, "weather": "clear"}).json()
    assert b["recommended"]["duration_s"] <= min(o["duration_s"] for o in b["options"]) + 60
    assert b["data_source"]["type"] == "synthetic"
    from datetime import datetime, timedelta, timezone
    arrive = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    b2 = client.post("/api/traffic/best-departure", headers=users["driver"],
                     json={"origin": MMU, "destination": HOSPITAL, "weather": "clear", "arrive_by": arrive}).json()
    on_time = [o for o in b2["options"] if o["on_time"]]
    assert b2["verdict"] == "ok" and b2["recommended"]["depart"] == on_time[-1]["depart"]


def test_model_metrics_compare_baseline(client, users):
    m = client.get("/api/traffic/model", headers=users["driver"]).json()["metrics"]
    for h in ("15", "30", "60"):
        assert m["horizons"][h]["ml"]["mae_kmh"] > 0 and m["horizons"][h]["baseline"]["mae_kmh"] > 0


# --- dashboards -------------------------------------------------------------------------------

def test_dashboard_updates_after_report(client, users):
    before = client.get("/api/dashboard/summary", headers=users["a"]).json()
    e = next(e for e in get_network("walk").edges.values() if e.highway == "footway" and e.length > 40
             and e.geom[0][0] > 2.915)
    p = e.geom[len(e.geom) // 2]
    client.post("/api/hazards", headers=users["a"], json={"category": "poor_lighting", "severity": "low",
                                                          "lat": p[0], "lon": p[1]})
    after = client.get("/api/dashboard/summary", headers=users["a"]).json()
    assert after["total"] == before["total"] + 1 and after["pending"] == before["pending"] + 1


def test_map_config_provider(client, users, monkeypatch):
    from app.config import get_settings
    cfg = client.get("/api/map/config", headers=users["b"]).json()
    assert cfg["provider"] == "leaflet" and cfg["google"] is None
    assert client.get("/api/map/config").status_code == 401
    monkeypatch.setattr(get_settings(), "google_maps_browser_key", "test-browser-key")
    cfg = client.get("/api/map/config", headers=users["b"]).json()
    assert cfg["provider"] == "google"
    assert cfg["google"] == {"browser_key": "test-browser-key", "map_id": "DEMO_MAP_ID"}


def test_deploy_seed_if_empty_keeps_data(client, users):
    from app.seed import ensure_seeded
    e = next(e for e in get_network("walk").edges.values() if e.length > 40)
    p = e.geom[len(e.geom) // 2]
    created = client.post("/api/hazards", headers=users["a"], json={"category": "other", "severity": "low",
                                                                    "lat": p[0], "lon": p[1]}).json()["incident"]["id"]
    assert ensure_seeded() == {"skipped": "database already seeded"}
    assert client.get(f"/api/hazards/{created}", headers=users["a"]).status_code == 200
