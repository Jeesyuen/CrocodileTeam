"""Explainable heuristic route safety scoring.

Safety Score = 100 × (1 − weighted risk), with risk factors normalised to [0, 1]
and aggregated over the route by segment length. These are heuristic estimates,
not validated accident probabilities. Missing data is scored as uncertainty
(0.5 risk) and lowers the reported data confidence — it is never treated as safe.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .graph import Edge
from .traffic_sim import MYT

WEIGHTS = {"active_hazards": 0.35, "historical_incidents": 0.25, "lighting": 0.15, "weather": 0.15,
           "condition": 0.10}
FACTOR_LABELS = {"active_hazards": "Active hazards", "historical_incidents": "Past incidents",
                 "lighting": "Lighting & visibility", "weather": "Weather", "condition": "Path condition"}
SEVERITY_RISK = {"low": 0.3, "medium": 0.55, "high": 0.8, "critical": 1.0}
CERTAINTY = {"warning": 0.6, "caution": 1.0, "closure": 1.0}
GOOD_SURFACE = {"asphalt", "paved", "concrete", "concrete:plates"}
OK_SURFACE = {"paving_stones", "sett", "bricks", "tiles", "metal", "wood"}
POOR_SURFACE = {"unpaved", "gravel", "dirt", "ground", "grass", "compacted", "fine_gravel", "sand", "mud"}


@dataclass
class HazardIndex:
    """Active incident impacts and historical incident counts, keyed by segment id."""
    active: dict[str, list[dict]] = field(default_factory=dict)        # seg -> [{incident_id, severity, impact_type}]
    historical: dict[str, int] = field(default_factory=dict)          # seg -> count of past incidents nearby
    closed: set[str] = field(default_factory=set)                     # segments with confirmed closures

    def active_risk(self, seg: str) -> float:
        return max((SEVERITY_RISK.get(h["severity"], 0.5) * CERTAINTY.get(h["impact_type"], 0.6)
                    for h in self.active.get(seg, ())), default=0.0)


def is_night(t: datetime) -> bool:
    h = t.astimezone(MYT).hour
    return h >= 19 or h < 7


def edge_factors(e: Edge, mode: str, hz: HazardIndex, rain: bool, night: bool) -> tuple[dict, dict]:
    """Returns (factor risks, known flags)."""
    known = {}
    a = hz.active_risk(e.seg)
    known["active_hazards"] = True
    hist = min(1.0, hz.historical.get(e.seg, 0) / 3)
    known["historical_incidents"] = True

    if e.lit == "yes":
        light = 0.1
        known["lighting"] = True
    elif e.lit == "no":
        light = 0.9
        known["lighting"] = True
    elif e.attrs.get("covered") == "yes":
        light, known["lighting"] = 0.3, True
    else:
        light, known["lighting"] = 0.5, False
    if not night:
        light *= 0.35  # daylight: lighting matters much less

    weather = (0.75 if mode == "drive" else 0.6) if rain else 0.1
    known["weather"] = True

    if e.surface in GOOD_SURFACE:
        cond, known["condition"] = 0.1, True
    elif e.surface in OK_SURFACE:
        cond, known["condition"] = 0.3, True
    elif e.surface in POOR_SURFACE:
        cond, known["condition"] = 0.75, True
    elif mode == "drive" and e.highway in ("primary", "secondary", "trunk", "motorway", "tertiary"):
        cond, known["condition"] = 0.2, True  # major roads are maintained paved roads
    else:
        cond, known["condition"] = 0.5, False
    if e.highway == "steps":
        cond = max(cond, 0.6)
    return {"active_hazards": a, "historical_incidents": hist, "lighting": light, "weather": weather,
            "condition": cond}, known


def edge_risk(e: Edge, mode: str, hz: HazardIndex, rain: bool, night: bool) -> float:
    f, _ = edge_factors(e, mode, hz, rain, night)
    return sum(WEIGHTS[k] * v for k, v in f.items())


def score_route(edges: list[Edge], mode: str, hz: HazardIndex, rain: bool, night: bool) -> dict:
    total = sum(e.length for e in edges) or 1.0
    agg = {k: 0.0 for k in WEIGHTS}
    known_len = {k: 0.0 for k in WEIGHTS}
    for e in edges:
        f, kn = edge_factors(e, mode, hz, rain, night)
        for k in WEIGHTS:
            agg[k] += f[k] * e.length
            if kn[k]:
                known_len[k] += e.length
    agg = {k: v / total for k, v in agg.items()}
    risk = sum(WEIGHTS[k] * agg[k] for k in WEIGHTS)
    # an active hazard anywhere on the route matters more than its length share suggests
    peak = max((hz.active_risk(e.seg) for e in edges), default=0.0)
    risk = min(1.0, risk + WEIGHTS["active_hazards"] * 0.35 * peak)
    score = round(100 * (1 - risk))
    confidence = sum(WEIGHTS[k] * known_len[k] / total for k in WEIGHTS)
    contributions = sorted(
        ({"factor": k, "label": FACTOR_LABELS[k], "risk": round(agg[k], 3), "weight": WEIGHTS[k],
          "contribution": round(WEIGHTS[k] * agg[k] * 100, 1), "known_share": round(known_len[k] / total, 2)}
         for k in WEIGHTS), key=lambda c: -c["contribution"])
    level = "low" if score >= 82 else "moderate" if score >= 65 else "elevated"
    return {"score": score, "risk_level": level, "factors": contributions,
            "data_confidence": round(confidence, 2),
            "confidence_label": "high" if confidence >= 0.8 else "medium" if confidence >= 0.6 else "low",
            "lit_share": round(sum(e.length for e in edges if e.lit == "yes") / total, 2),
            "conditions": {"rain": rain, "night": night}}
