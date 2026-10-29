from fastapi import APIRouter, Depends, Query

from ..schemas import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN
from ..security import get_current_user
from ..services.graph import get_network, get_places, get_traffic_segments
from ..services.incidents import location_label, match_location

router = APIRouter(prefix="/api", tags=["map"], dependencies=[Depends(get_current_user)])


@router.get("/places")
def search_places(q: str = Query("", max_length=80), limit: int = Query(8, le=30)):
    q = q.strip().lower()
    places = get_places()
    if not q:
        featured = [p for p in places if p["kind"] in ("university", "college", "hospital", "park", "mall",
                                                       "government", "townhall", "library")]
        return featured[:limit]
    starts = [p for p in places if p["name"].lower().startswith(q)]
    contains = [p for p in places if q in p["name"].lower() and p not in starts]
    return (starts + contains)[:limit]


@router.get("/map/config")
def map_config():
    return {
        "pilot_bounds": [[LAT_MIN, LON_MIN], [LAT_MAX, LON_MAX]],
        "center": [2.9230, 101.6440],
        "networks": {m: {"nodes": len(get_network(m).nodes), "edges": len(get_network(m).edges)}
                     for m in ("walk", "drive")},
        "traffic_segments": len(get_traffic_segments()),
        "data_attribution": "Road & path network © OpenStreetMap contributors (ODbL)",
    }


@router.get("/map/match")
def match(lat: float, lon: float, relevance: str = Query("both", pattern="^(walk|drive|both)$")):
    """Preview how a reported location links to mapped path segments."""
    return {"matches": match_location(lat, lon, relevance), "location_label": location_label(lat, lon)}
