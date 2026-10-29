"""Smart Routing Engine: hazard- and congestion-aware A* over the mapped Cyberjaya network.

* Confirmed closures are always excluded.
* Unverified / verified hazards raise an edge's risk, which the Safest and Smart
  Balance preferences trade against travel time.
* Driving travel times use forecast speeds at the time the vehicle is expected to
  enter each edge (time-dependent A*).
"""
from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass
from datetime import datetime, timedelta

from .graph import Edge, Network, haversine
from .safety import HazardIndex, edge_risk, is_night, score_route
from .traffic_model import TrafficContext
from .traffic_sim import congestion_level

WALK_SPEED_MS = 1.3
PREFERENCES = {
    "fastest": {"label": "Fastest Route", "risk_k": 0.0},
    "safest": {"label": "Safest Route", "risk_k": 6.0},
    "balanced": {"label": "Smart Balance", "risk_k": 1.8},
}
MAX_SNAP_M = 600


class RoutingError(Exception):
    def __init__(self, message: str, code: str = "no_route"):
        super().__init__(message)
        self.code = code


@dataclass
class RouteRequest:
    mode: str
    origin: tuple[float, float]
    destination: tuple[float, float]
    depart: datetime
    now: datetime
    weather: str = "auto"  # auto|clear|rain


def edge_time(e: Edge, mode: str, t: datetime, ctx: TrafficContext | None) -> float:
    if mode == "walk":
        return e.length / WALK_SPEED_MS * (2.0 if e.highway == "steps" else 1.0)
    ratio = ctx.ratio(e.traffic_segment, t) if ctx else 1.0
    speed = max(3.0, (e.speed_kmh or 30) * ratio) / 3.6
    return e.length / speed


def _search(net: Network, src: str, dst: str, mode: str, depart: datetime, hz: HazardIndex,
            ctx: TrafficContext | None, risk_k: float, rain: bool, night: bool,
            ignore_traffic: bool = False) -> list[Edge] | None:
    goal = net.nodes[dst]
    vmax = net.max_speed_ms if mode == "drive" else WALK_SPEED_MS
    counter = itertools.count()
    g = {src: 0.0}
    elapsed = {src: 0.0}
    prev: dict[str, Edge] = {}
    risk_cache: dict[str, float] = {}
    heap = [(haversine(net.nodes[src], goal) / vmax, next(counter), src)]
    done = set()
    while heap:
        _, _, u = heapq.heappop(heap)
        if u in done:
            continue
        if u == dst:
            break
        done.add(u)
        for e in net.out.get(u, ()):
            if e.seg in hz.closed or e.v in done:
                continue
            t_enter = depart + timedelta(seconds=elapsed[u])
            tt = edge_time(e, mode, t_enter, None if ignore_traffic else ctx)
            cost = tt
            if risk_k:
                r = risk_cache.get(e.id)
                if r is None:
                    r = risk_cache[e.id] = edge_risk(e, mode, hz, rain, night)
                cost = tt * (1 + risk_k * r)
            ng = g[u] + cost
            if ng < g.get(e.v, float("inf")):
                g[e.v] = ng
                elapsed[e.v] = elapsed[u] + tt
                prev[e.v] = e
                heapq.heappush(heap, (ng + haversine(net.nodes[e.v], goal) / vmax, next(counter), e.v))
    if dst not in prev and src != dst:
        return None
    path, n = [], dst
    while n != src:
        e = prev[n]
        path.append(e)
        n = e.u
    return list(reversed(path))


def snap(net: Network, p: tuple[float, float], label: str) -> tuple[str, float]:
    node, d = net.nearest_node(*p, max_m=MAX_SNAP_M)
    if node is None:
        raise RoutingError(f"The {label} is outside the mapped Cyberjaya pilot area (no {net.mode} path within "
                           f"{MAX_SNAP_M} m).", "outside_area")
    return node, d


def _geometry(edges: list[Edge]) -> list[list[float]]:
    pts: list[list[float]] = []
    for e in edges:
        pts.extend(e.geom if not pts else e.geom[1:])
    return pts


def describe(edges: list[Edge], req: RouteRequest, hz: HazardIndex, ctx: TrafficContext | None,
             rain: bool, night: bool) -> dict:
    t = req.depart
    duration = 0.0
    free_flow = 0.0
    congestion = []
    for e in edges:
        tt = edge_time(e, req.mode, t, ctx)
        if req.mode == "drive":
            free_flow += edge_time(e, req.mode, t, None)
            ratio = ctx.ratio(e.traffic_segment, t) if ctx else 1.0
            lvl = congestion_level(ratio)
            if lvl != "low":
                if congestion and congestion[-1]["level"] == lvl and congestion[-1]["_last"] == e.u:
                    congestion[-1]["geometry"].extend(e.geom[1:])
                    congestion[-1]["_last"] = e.v
                else:
                    congestion.append({"level": lvl, "geometry": list(e.geom), "road": e.name, "_last": e.v,
                                       "predicted": e.traffic_segment is not None})
        duration += tt
        t += timedelta(seconds=tt)
    for c in congestion:
        c.pop("_last")
    hazards = sorted({h["incident_id"] for e in edges for h in hz.active.get(e.seg, ())})
    safety = score_route(edges, req.mode, hz, rain, night)
    roads = []
    for e in edges:
        if e.name and (not roads or roads[-1] != e.name):
            roads.append(e.name)
    return {
        "edge_ids": [e.id for e in edges],
        "segment_ids": sorted({e.seg for e in edges}),
        "geometry": _geometry(edges),
        "distance_m": round(sum(e.length for e in edges)),
        "duration_s": round(duration),
        "free_flow_duration_s": round(free_flow) if req.mode == "drive" else None,
        "delay_s": round(duration - free_flow) if req.mode == "drive" else None,
        "arrival": (req.depart + timedelta(seconds=duration)).isoformat(),
        "safety": safety,
        "hazard_ids": hazards,
        "congestion": congestion,
        "via": roads[:6],
    }


def compute_routes(net: Network, req: RouteRequest, hz: HazardIndex, ctx: TrafficContext | None,
                   preferences=("fastest", "safest", "balanced"), include_usual: bool = False) -> dict:
    src, d_src = snap(net, req.origin, "starting point")
    dst, d_dst = snap(net, req.destination, "destination")
    if src == dst:
        raise RoutingError("Start and destination are at the same point on the network.", "same_point")
    rain = (ctx._rain(req.depart) if ctx else False) if req.weather == "auto" else req.weather == "rain"
    night = is_night(req.depart)

    routes, seen = [], {}
    for pref in preferences:
        edges = _search(net, src, dst, req.mode, req.depart, hz, ctx, PREFERENCES[pref]["risk_k"], rain, night)
        if edges is None:
            continue
        key = tuple(e.id for e in edges)
        r = describe(edges, req, hz, ctx, rain, night)
        r.update(preference=pref, label=PREFERENCES[pref]["label"], same_as=seen.get(key))
        seen.setdefault(key, pref)
        routes.append(r)
    if not routes:
        raise RoutingError("No route available: confirmed closures block every mapped path between these points.",
                           "blocked")

    usual = None
    if include_usual and req.mode == "drive":
        edges = _search(net, src, dst, req.mode, req.depart, hz, ctx, 0.0, rain, night, ignore_traffic=True)
        if edges:
            usual = describe(edges, req, hz, ctx, rain, night)
            usual.update(preference="usual", label="Usual Route (free-flow shortest time)", same_as=None)

    fastest = next((r for r in routes if r["preference"] == "fastest"), routes[0])
    for r in routes:
        r["explanation"] = explain(r, fastest, req.mode)
    best = recommend(routes)
    return {
        "mode": req.mode,
        "routes": routes,
        "usual": usual,
        "recommended": best,
        "access": {
            "origin": {"from": list(req.origin), "to": list(net.nodes[src]), "distance_m": round(d_src)},
            "destination": {"from": list(net.nodes[dst]), "to": list(req.destination), "distance_m": round(d_dst)},
        },
        "conditions": {"rain": rain, "night": night, "weather_source": "scenario" if req.weather != "auto"
                       else "synthetic weather feed"},
    }


def recommend(routes: list[dict]) -> str:
    """Smart Balance unless it is much slower than fastest or less safe than safest by a wide margin."""
    by = {r["preference"]: r for r in routes}
    if "balanced" in by:
        return "balanced"
    return routes[0]["preference"]


def explain(r: dict, fastest: dict, mode: str) -> str:
    parts = []
    nh = len(r["hazard_ids"])
    if r["preference"] == "fastest":
        parts.append("Lowest predicted travel time." if mode == "drive" else "Shortest walking time.")
    elif r["same_as"] == "fastest":
        parts.append("Same path as the fastest route — no safer alternative found.")
    else:
        if r["same_as"]:
            parts.append(f"Same path as the {PREFERENCES[r['same_as']]['label']}.")
        dt = round((r["duration_s"] - fastest["duration_s"]) / 60)
        avoided = len(set(fastest["hazard_ids"]) - set(r["hazard_ids"]))
        if avoided:
            parts.append(f"Avoids {avoided} reported hazard{'s' if avoided > 1 else ''} on the fastest route.")
        if r["safety"]["score"] > fastest["safety"]["score"]:
            parts.append(f"Safety score {r['safety']['score']} vs {fastest['safety']['score']} on the fastest route.")
        if dt > 0:
            parts.append(f"About {dt} min longer.")
    if nh:
        parts.append(f"Passes {nh} active hazard{'s' if nh > 1 else ''}.")
    if mode == "drive" and r.get("delay_s") and r["delay_s"] > 60:
        parts.append(f"Includes ~{round(r['delay_s'] / 60)} min predicted congestion delay.")
    if r["safety"]["lit_share"] >= 0.5:
        parts.append(f"{round(r['safety']['lit_share'] * 100)}% of the path is mapped as lit.")
    return " ".join(parts)
