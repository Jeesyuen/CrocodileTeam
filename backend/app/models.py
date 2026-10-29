"""Database schema.

Geometry is stored as lat/lon columns + GeoJSON-style JSON so the same models run on
SQLite (zero-setup demo) and PostgreSQL. `migrations/001_postgis.sql` adds PostGIS
geometry columns and spatial indexes when running on Postgres.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TZDateTime(TypeDecorator):
    """Stores UTC, always returns timezone-aware datetimes (SQLite drops tzinfo otherwise)."""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None else None


class Role:
    STUDENT = "student"
    DRIVER = "driver"
    OPERATOR = "operator"
    MAINTENANCE = "maintenance"
    ALL = (STUDENT, DRIVER, OPERATOR, MAINTENANCE)


class Status:
    SUBMITTED = "submitted"
    PENDING = "pending_verification"
    VERIFIED = "verified_active"
    IN_PROGRESS = "in_progress"
    AWAITING_CLEARANCE = "awaiting_clearance"
    RESOLVED = "resolved"
    REJECTED = "rejected"
    DUPLICATE = "duplicate"
    EXPIRED = "expired_review"
    ACTIVE = (SUBMITTED, PENDING, VERIFIED, IN_PROGRESS, AWAITING_CLEARANCE, EXPIRED)
    CLOSED = (RESOLVED, REJECTED, DUPLICATE)


class Restriction:
    NONE = "none"
    ADVISORY = "advisory"      # unverified report: provisional warning, small routing penalty
    CAUTION = "caution"        # verified hazard that does not block the path
    CLOSED = "closed"          # operator-confirmed closure: edges excluded from routing


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    avatar_color: Mapped[str] = mapped_column(String(16), default="#E9E3FF")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    primary_report_id: Mapped[int | None] = mapped_column(ForeignKey("hazard_reports.id", use_alter=True), nullable=True)
    category: Mapped[str] = mapped_column(String(40), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(16), index=True)
    verification_status: Mapped[str] = mapped_column(String(32), index=True, default=Status.PENDING)
    restriction_status: Mapped[str] = mapped_column(String(16), default=Restriction.ADVISORY)
    obstruction: Mapped[str] = mapped_column(String(16), default="unknown")  # none|partial|complete|unknown
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    location_label: Mapped[str] = mapped_column(String(200), default="")
    mode_relevance: Mapped[str] = mapped_column(String(10), default="both")  # walk|drive|both
    match_quality: Mapped[str] = mapped_column(String(16), default="none")  # reliable|approximate|none
    report_count: Mapped[int] = mapped_column(Integer, default=1)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, onupdate=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)

    reports: Mapped[list["HazardReport"]] = relationship(back_populates="incident", foreign_keys="HazardReport.incident_id")
    impacts: Mapped[list["IncidentPathImpact"]] = relationship(back_populates="incident", cascade="all, delete-orphan")
    history: Mapped[list["IncidentHistory"]] = relationship(back_populates="incident", cascade="all, delete-orphan",
                                                            order_by="IncidentHistory.created_at")


class HazardReport(Base):
    __tablename__ = "hazard_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    severity: Mapped[str] = mapped_column(String(16))
    obstruction: Mapped[str] = mapped_column(String(16), default="unknown")
    status: Mapped[str] = mapped_column(String(32), default=Status.SUBMITTED)
    ai_suggestion_used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, index=True)

    reporter: Mapped[User] = relationship()
    incident: Mapped[Incident | None] = relationship(back_populates="reports", foreign_keys=[incident_id])
    images: Mapped[list["HazardImage"]] = relationship(back_populates="report", cascade="all, delete-orphan")
    analyses: Mapped[list["AIAnalysis"]] = relationship(back_populates="report", cascade="all, delete-orphan")


class HazardImage(Base):
    __tablename__ = "hazard_images"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("hazard_reports.id"), nullable=True, index=True)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    storage_path: Mapped[str] = mapped_column(String(300))
    media_type: Mapped[str] = mapped_column(String(40), default="image/jpeg")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    report: Mapped[HazardReport | None] = relationship(back_populates="images")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("hazard_reports.id"), nullable=True, index=True)
    image_id: Mapped[int | None] = mapped_column(ForeignKey("hazard_images.id"), nullable=True)
    model_name: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(24))  # ok|unavailable|error|uncertain
    classification: Mapped[str | None] = mapped_column(String(40), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    report: Mapped[HazardReport | None] = relationship(back_populates="analyses")


class PathNode(Base):
    __tablename__ = "path_nodes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    network: Mapped[str] = mapped_column(String(8), primary_key=True)  # walk|drive
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    node_type: Mapped[str] = mapped_column(String(16), default="junction")


class PathEdge(Base):
    __tablename__ = "path_edges"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    segment_id: Mapped[str] = mapped_column(String(32), index=True)  # both directions share a segment id
    source_node: Mapped[str] = mapped_column(String(32))
    target_node: Mapped[str] = mapped_column(String(32))
    geometry: Mapped[list] = mapped_column(JSON)
    distance: Mapped[float] = mapped_column(Float)
    transport_mode: Mapped[str] = mapped_column(String(8), index=True)
    road_class: Mapped[str] = mapped_column(String(24))
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    accessibility: Mapped[dict] = mapped_column(JSON, default=dict)
    restriction_status: Mapped[str] = mapped_column(String(16), default=Restriction.NONE)
    traffic_segment_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


class IncidentPathImpact(Base):
    __tablename__ = "incident_path_impacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    network: Mapped[str] = mapped_column(String(8))
    segment_id: Mapped[str] = mapped_column(String(32), index=True)
    distance_m: Mapped[float] = mapped_column(Float)
    impact_type: Mapped[str] = mapped_column(String(16))  # warning|caution|closure
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    incident: Mapped[Incident] = relationship(back_populates="impacts")


class RouteSession(Base):
    __tablename__ = "route_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    mode: Mapped[str] = mapped_column(String(8))
    preference: Mapped[str] = mapped_column(String(16))
    origin: Mapped[dict] = mapped_column(JSON)
    destination: Mapped[dict] = mapped_column(JSON)
    active_edge_ids: Mapped[list] = mapped_column(JSON, default=list)
    active_segment_ids: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, onupdate=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(40))
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)


class MaintenanceTask(Base):
    __tablename__ = "maintenance_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    assigned_to: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="assigned")  # assigned|in_progress|awaiting_clearance|closed
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    instructions: Mapped[str] = mapped_column(Text, default="")
    resolution_notes: Mapped[str] = mapped_column(Text, default="")
    completion_image_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    incident: Mapped[Incident] = relationship()
    assignee: Mapped[User] = relationship(foreign_keys=[assigned_to])


class IncidentHistory(Base):
    __tablename__ = "incident_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    incident: Mapped[Incident] = relationship(back_populates="history")
    actor: Mapped[User | None] = relationship()


class TrafficObservation(Base):
    __tablename__ = "traffic_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    road_segment_id: Mapped[str] = mapped_column(String(64))
    timestamp: Mapped[datetime] = mapped_column(TZDateTime())
    average_speed: Mapped[float] = mapped_column(Float)
    travel_time: Mapped[float] = mapped_column(Float)
    rain: Mapped[bool] = mapped_column(Boolean, default=False)
    incident: Mapped[bool] = mapped_column(Boolean, default=False)
    data_source: Mapped[str] = mapped_column(String(32), default="synthetic")
    __table_args__ = (Index("ix_traffic_obs_seg_ts", "road_segment_id", "timestamp"),)


class TrafficPrediction(Base):
    __tablename__ = "traffic_predictions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    road_segment_id: Mapped[str] = mapped_column(String(64), index=True)
    prediction_time: Mapped[datetime] = mapped_column(TZDateTime())
    target_time: Mapped[datetime] = mapped_column(TZDateTime())
    forecast_horizon: Mapped[int] = mapped_column(Integer)
    predicted_speed: Mapped[float] = mapped_column(Float)
    predicted_travel_time: Mapped[float] = mapped_column(Float)
    congestion_level: Mapped[str] = mapped_column(String(12))
    model_version: Mapped[str] = mapped_column(String(40))


class TrafficModelVersion(Base):
    __tablename__ = "traffic_model_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_name: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(40))
    evaluation_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    data_source: Mapped[str] = mapped_column(String(32), default="synthetic")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
