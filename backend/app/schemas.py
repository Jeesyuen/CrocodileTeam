from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .services.ai_vision import CATEGORIES

Severity = Literal["low", "medium", "high", "critical"]
Mode = Literal["walk", "drive"]
Weather = Literal["auto", "clear", "rain"]
Obstruction = Literal["none", "partial", "complete", "unknown"]
Relevance = Literal["walk", "drive", "both"]

# Cyberjaya pilot bounding box (matches the OSM extract)
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 2.905, 2.935, 101.630, 101.665


class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    label: str | None = Field(default=None, max_length=200)


def check_lat(v: float) -> float:
    if not LAT_MIN <= v <= LAT_MAX:
        raise ValueError("Location is outside the Cyberjaya pilot area")
    return v


def check_lon(v: float) -> float:
    if not LON_MIN <= v <= LON_MAX:
        raise ValueError("Location is outside the Cyberjaya pilot area")
    return v


class PilotPoint(Point):
    _lat = field_validator("lat")(classmethod(lambda cls, v: check_lat(v)))
    _lon = field_validator("lon")(classmethod(lambda cls, v: check_lon(v)))


class CompareIn(BaseModel):
    mode: Mode
    origin: PilotPoint
    destination: PilotPoint
    depart_at: datetime | None = None
    weather: Weather = "auto"


class SessionIn(BaseModel):
    mode: Mode
    preference: Literal["fastest", "safest", "balanced"]
    origin: PilotPoint
    destination: PilotPoint
    edge_ids: list[str] = Field(max_length=5000)
    segment_ids: list[str] = Field(max_length=5000)


class HazardIn(BaseModel):
    category: str
    severity: Severity
    description: str = Field(default="", max_length=1000)
    lat: float
    lon: float
    obstruction: Obstruction = "unknown"
    mode_relevance: Relevance | None = None
    image_ids: list[int] = Field(default_factory=list, max_length=4)
    ai_suggestion_used: bool = False

    @field_validator("category")
    @classmethod
    def _cat(cls, v):
        if v not in CATEGORIES:
            raise ValueError("Unknown hazard category")
        return v

    _lat = field_validator("lat")(classmethod(lambda cls, v: check_lat(v)))
    _lon = field_validator("lon")(classmethod(lambda cls, v: check_lon(v)))


class AnalyzeIn(BaseModel):
    image_id: int


class VerifyIn(BaseModel):
    severity: Severity | None = None
    restriction: Literal["caution", "closed"] = "caution"
    note: str = Field(default="", max_length=500)


class NoteIn(BaseModel):
    note: str = Field(default="", max_length=500)


class MergeIn(BaseModel):
    target_id: int
    note: str = Field(default="", max_length=500)


class ImpactIn(BaseModel):
    restriction: Literal["none", "advisory", "caution", "closed"] | None = None
    severity: Severity | None = None
    lat: float | None = None
    lon: float | None = None
    mode_relevance: Relevance | None = None
    note: str = Field(default="", max_length=500)


class AssignIn(BaseModel):
    assignee_id: int
    instructions: str = Field(default="", max_length=1000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"


class TaskUpdateIn(BaseModel):
    status: Literal["in_progress", "awaiting_clearance"] | None = None
    resolution_notes: str | None = Field(default=None, max_length=2000)
    completion_image_id: int | None = None


class TrafficRouteIn(BaseModel):
    origin: PilotPoint
    destination: PilotPoint
    depart_at: datetime | None = None
    weather: Weather = "auto"


class BestDepartureIn(BaseModel):
    origin: PilotPoint
    destination: PilotPoint
    arrive_by: datetime | None = None
    weather: Weather = "auto"
    window_minutes: int = Field(default=150, ge=30, le=180)
