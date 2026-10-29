"""In-memory routing networks built from real OpenStreetMap ways (see scripts/build_graph.py).

Walking and driving networks are separate objects and are never mixed.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache

from ..config import get_settings

CELL = 0.001  # ~110 m grid cells for the spatial index


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    d = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(min(1.0, d)))


def point_segment_distance(p, a, b) -> tuple[float, float]:
    """Distance in metres from p to segment ab (local equirectangular projection) and the fraction t along ab."""
    k = math.cos(math.radians(p[0]))
    ax, ay = (a[1] - p[1]) * k, a[0] - p[0]
    bx, by = (b[1] - p[1]) * k, b[0] - p[0]
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(cx, cy) * 111_320, t


@dataclass
class Edge:
    id: str
    u: str
    v: str
    seg: str
    geom: list[list[float]]
    length: float
    highway: str
    name: str | None
    lit: str | None
    surface: str | None
    speed_kmh: float | None
    traffic_segment: str | None
    attrs: dict = field(default_factory=dict)


class Network:
    def __init__(self, mode: str, data: dict):
        self.mode = mode
        self.nodes: dict[str, tuple[float, float]] = {k: (v[0], v[1]) for k, v in data["nodes"].items()}
        self.edges: dict[str, Edge] = {}
        self.out: dict[str, list[Edge]] = defaultdict(list)
        self.seg_edges: dict[str, list[Edge]] = defaultdict(list)
        self.edge_grid: dict[tuple[int, int], set[str]] = defaultdict(set)
        self.node_grid: dict[tuple[int, int], list[str]] = defaultdict(list)
        for e in data["edges"]:
            edge = Edge(
                id=e["id"], u=e["u"], v=e["v"], seg=e["seg"], geom=e["geom"], length=e["length"],
                highway=e["highway"], name=e.get("name"), lit=e.get("lit"), surface=e.get("surface"),
                speed_kmh=e.get("speed_kmh"), traffic_segment=e.get("traffic_segment"),
                attrs={k: e[k] for k in ("lanes", "covered", "wheelchair", "way_id") if k in e},
            )
            self.edges[edge.id] = edge
            self.out[edge.u].append(edge)
            self.seg_edges[edge.seg].append(edge)
            for lat, lon in edge.geom:
                self.edge_grid[self._cell(lat, lon)].add(edge.id)
            # also index interpolated points so long straight edges are found
            for (a, b) in zip(edge.geom, edge.geom[1:]):
                n = int(haversine(a, b) // 80)
                for i in range(1, n + 1):
                    f = i / (n + 1)
                    self.edge_grid[self._cell(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)].add(edge.id)
        for nid, (lat, lon) in self.nodes.items():
            self.node_grid[self._cell(lat, lon)].append(nid)
        self.max_speed_ms = (max((e.speed_kmh or 0) for e in self.edges.values()) / 3.6) if mode == "drive" else 1.4

    @staticmethod
    def _cell(lat, lon):
        return (int(math.floor(lat / CELL)), int(math.floor(lon / CELL)))

    def _cells_around(self, lat, lon, radius_m):
        r = int(math.ceil(radius_m / 110)) + 1
        ci, cj = self._cell(lat, lon)
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                yield (ci + di, cj + dj)

    def nearest_node(self, lat: float, lon: float, max_m: float = 600) -> tuple[str | None, float]:
        best, bd = None, float("inf")
        for c in self._cells_around(lat, lon, max_m):
            for nid in self.node_grid.get(c, ()):
                d = haversine((lat, lon), self.nodes[nid])
                if d < bd:
                    best, bd = nid, d
        return (best, bd) if bd <= max_m else (None, bd)

    def edges_near(self, lat: float, lon: float, radius_m: float) -> list[tuple[Edge, float]]:
        seen, found = set(), []
        for c in self._cells_around(lat, lon, radius_m):
            for eid in self.edge_grid.get(c, ()):
                if eid in seen:
                    continue
                seen.add(eid)
                e = self.edges[eid]
                d = min(point_segment_distance((lat, lon), a, b)[0] for a, b in zip(e.geom, e.geom[1:]))
                if d <= radius_m:
                    found.append((e, d))
        return sorted(found, key=lambda x: x[1])

    def bounds(self):
        lats = [p[0] for p in self.nodes.values()]
        lons = [p[1] for p in self.nodes.values()]
        return [[min(lats), min(lons)], [max(lats), max(lons)]]


@lru_cache
def get_network(mode: str) -> Network:
    if mode not in ("walk", "drive"):
        raise ValueError(f"Unsupported network: {mode}")
    path = get_settings().data_dir / f"graph_{mode}.json"
    return Network(mode, json.loads(path.read_text(encoding="utf-8")))


@lru_cache
def get_places() -> list[dict]:
    return json.loads((get_settings().data_dir / "places.json").read_text(encoding="utf-8"))


@lru_cache
def get_traffic_segments() -> list[dict]:
    return json.loads((get_settings().data_dir / "traffic_segments.json").read_text(encoding="utf-8"))
