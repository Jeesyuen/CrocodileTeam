"""Build SafeRoute AI routing graphs from the OpenStreetMap extract.

Input:  data/raw/cyberjaya_osm.json   (Overpass export, ODbL © OpenStreetMap contributors)
        data/raw/cyberjaya_pois.json
Output: data/graph_walk.json, data/graph_drive.json, data/places.json, data/traffic_segments.json

Walking and driving networks are built separately and never mixed:
  * drive: directed edges, honours oneway / roundabouts, no footways
  * walk:  undirected (stored as two directed edges), no motorways / trunk roads

Ways are split at shared nodes so every edge is a real OSM road piece between
two junctions; degree-2 nodes are folded into the edge geometry. Only the largest
strongly connected component of each network is kept so every pair of nodes is
routable.
"""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path

import networkx as nx

DATA = Path(__file__).resolve().parents[1] / "data"
RAW = DATA / "raw"

DRIVE_TYPES = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "living_street", "service",
}
WALK_TYPES = {
    "footway", "pedestrian", "path", "steps", "cycleway", "living_street", "residential",
    "unclassified", "service", "tertiary", "secondary", "primary",
    "tertiary_link", "secondary_link", "primary_link",
}
FREE_FLOW_KMH = {
    "motorway": 90, "trunk": 70, "primary": 60, "secondary": 50, "tertiary": 40,
    "motorway_link": 50, "trunk_link": 45, "primary_link": 40, "secondary_link": 35,
    "tertiary_link": 30, "unclassified": 35, "residential": 30, "living_street": 15, "service": 20,
}
# Major roads get a named traffic-forecast segment; minor roads use a local profile.
TRAFFIC_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary"}


def haversine(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    d = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(d))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def load_osm():
    d = json.loads((RAW / "cyberjaya_osm.json").read_text(encoding="utf-8"))
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in d["elements"] if e["type"] == "node"}
    ways = [e for e in d["elements"] if e["type"] == "way"]
    return nodes, ways


def drive_ok(tags):
    hw = tags.get("highway")
    if hw not in DRIVE_TYPES:
        return False
    if tags.get("access") in ("private", "no") or tags.get("motor_vehicle") in ("no", "private"):
        return False
    if hw == "service" and tags.get("service") in ("drive-through", "emergency_access"):
        return False
    return True


def walk_ok(tags):
    hw = tags.get("highway")
    if hw not in WALK_TYPES:
        return False
    if tags.get("foot") in ("no", "private") or tags.get("access") in ("private", "no") and tags.get("foot") not in ("yes", "designated"):
        return False
    if hw in ("primary", "secondary") and tags.get("sidewalk") == "no":
        return False
    return True


def oneway_dir(tags):
    ow = tags.get("oneway")
    if ow in ("yes", "1", "true"):
        return 1
    if ow == "-1":
        return -1
    if ow == "no":
        return 0
    if tags.get("junction") in ("roundabout", "circular") or tags.get("highway") in ("motorway", "motorway_link"):
        return 1
    return 0


def parse_speed(tags):
    m = re.match(r"(\d+)", tags.get("maxspeed", ""))
    if m:
        return int(m.group(1))
    return FREE_FLOW_KMH.get(tags.get("highway"), 30)


def build(mode: str, nodes, ways):
    ok = drive_ok if mode == "drive" else walk_ok
    sel = [w for w in ways if ok(w["tags"])]
    use = defaultdict(int)
    for w in sel:
        for i, n in enumerate(w["nodes"]):
            use[n] += 2 if i in (0, len(w["nodes"]) - 1) else 1

    G = nx.MultiDiGraph()
    seg_counter = 0
    for w in sel:
        t = w["tags"]
        ns = [n for n in w["nodes"] if n in nodes]
        if len(ns) < 2:
            continue
        pieces, cur = [], [ns[0]]
        for n in ns[1:]:
            cur.append(n)
            if use[n] > 1:
                pieces.append(cur)
                cur = [n]
        if len(cur) > 1:
            pieces.append(cur)
        ow = oneway_dir(t) if mode == "drive" else 0
        for p in pieces:
            geom = [nodes[n] for n in p]
            length = sum(haversine(geom[i], geom[i + 1]) for i in range(len(geom) - 1))
            if length < 0.5:
                continue
            seg_counter += 1
            seg = f"{mode[0]}s{seg_counter}"
            attrs = dict(
                seg=seg, way_id=w["id"], highway=t.get("highway"), name=t.get("name") or t.get("name:en"),
                length=round(length, 1), lit=t.get("lit"), surface=t.get("surface"),
                speed_kmh=parse_speed(t) if mode == "drive" else None,
                lanes=t.get("lanes"), covered=t.get("covered"), wheelchair=t.get("wheelchair"),
            )
            if ow >= 0:
                G.add_edge(p[0], p[-1], geom=geom, **attrs)
            if ow <= 0:
                G.add_edge(p[-1], p[0], geom=list(reversed(geom)), **attrs)

    comp = max(nx.strongly_connected_components(G), key=len)
    G = G.subgraph(comp).copy()

    out_nodes = {str(n): [round(nodes[n][0], 7), round(nodes[n][1], 7)] for n in G.nodes}
    out_edges = []
    for i, (u, v, a) in enumerate(G.edges(data=True)):
        e = {"id": f"{mode[0]}e{i}", "u": str(u), "v": str(v),
             "geom": [[round(x, 7), round(y, 7)] for x, y in a.pop("geom")], **a}
        if mode == "drive" and a["highway"] in TRAFFIC_CLASSES and a["name"]:
            e["traffic_segment"] = slug(a["name"])[:48]
        out_edges.append({k: v for k, v in e.items() if v is not None})
    return {"mode": mode, "nodes": out_nodes, "edges": out_edges}


def traffic_segments(drive):
    segs = {}
    for e in drive["edges"]:
        sid = e.get("traffic_segment")
        if not sid:
            continue
        s = segs.setdefault(sid, {"id": sid, "name": e["name"], "highway": e["highway"],
                                  "free_flow_kmh": e["speed_kmh"], "length_m": 0.0, "edge_count": 0,
                                  "lanes": e.get("lanes")})
        s["length_m"] += e["length"]
        s["edge_count"] += 1
        rank = list(FREE_FLOW_KMH).index
        if rank(e["highway"]) < rank(s["highway"]):
            s["highway"], s["free_flow_kmh"] = e["highway"], e["speed_kmh"]
    for s in segs.values():
        s["length_m"] = round(s["length_m"], 1)
    return sorted(segs.values(), key=lambda s: -s["length_m"])


KEEP_POI = {
    "university", "college", "school", "hospital", "clinic", "library", "park", "townhall", "fire_station",
    "police", "bus_station", "mall", "supermarket", "hotel", "apartments", "dormitory", "government", "office",
    "company", "cafe", "restaurant", "fast_food", "community_centre", "sports_centre", "stadium", "attraction",
    "commercial", "retail", "it", "station", "place_of_worship", "bank", "fuel",
}
NOISE_NAMES = {"parking area", "hall", "canteen", "surau", "musolla", "parking"}


def places():
    d = json.loads((RAW / "cyberjaya_pois.json").read_text(encoding="utf-8"))
    out, seen = [], set()
    for e in d["elements"]:
        t = e["tags"]
        name = t.get("name:en") or t.get("name")
        kind = t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("leisure") or t.get("office") or t.get("public_transport") or t.get("building")
        if kind == "yes":
            kind = "office"
        if not name or kind not in KEEP_POI or name.lower() in NOISE_NAMES:
            continue
        lat = e.get("lat") or e.get("center", {}).get("lat")
        lon = e.get("lon") or e.get("center", {}).get("lon")
        if lat is None or not (2.9050 <= lat <= 2.9350 and 101.6300 <= lon <= 101.6650):
            continue
        key = (name.lower(), round(lat, 3), round(lon, 3))
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": f"osm-{e['type'][0]}{e['id']}", "name": name, "kind": kind,
                    "lat": round(lat, 7), "lon": round(lon, 7)})
    return sorted(out, key=lambda p: p["name"].lower())


def main():
    nodes, ways = load_osm()
    walk = build("walk", nodes, ways)
    drive = build("drive", nodes, ways)
    (DATA / "graph_walk.json").write_text(json.dumps(walk, separators=(",", ":")), encoding="utf-8")
    (DATA / "graph_drive.json").write_text(json.dumps(drive, separators=(",", ":")), encoding="utf-8")
    segs = traffic_segments(drive)
    (DATA / "traffic_segments.json").write_text(json.dumps(segs, indent=1, ensure_ascii=False), encoding="utf-8")
    pl = places()
    (DATA / "places.json").write_text(json.dumps(pl, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"walk: {len(walk['nodes'])} nodes / {len(walk['edges'])} edges")
    print(f"drive: {len(drive['nodes'])} nodes / {len(drive['edges'])} edges")
    print(f"traffic segments: {len(segs)}; places: {len(pl)}")


if __name__ == "__main__":
    main()
