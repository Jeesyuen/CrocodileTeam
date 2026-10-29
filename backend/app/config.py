from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    app_name: str = "SafeRoute AI"
    # SQLite works out of the box; set a postgresql+psycopg:// URL to use Postgres/PostGIS.
    database_url: str = f"sqlite:///{(BASE_DIR / 'saferoute.db').as_posix()}"
    jwt_secret: str = "dev-only-secret-change-me-in-production-0123456789"
    jwt_expiry_minutes: int = 60 * 12
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Hazard image analysis (server-side only). Leave blank to run without AI.
    anthropic_api_key: str = ""
    vision_model: str = "claude-opus-5-5"
    vision_timeout_seconds: float = 45.0

    # Google Maps JavaScript API + Places API (New). This is a *browser* key: it is sent to
    # signed-in clients, so restrict it to your site's HTTP referrers and to those two APIs.
    # Leave blank to use the Leaflet/OpenStreetMap demo map.
    google_maps_browser_key: str = ""
    # Map ID (required for Advanced Markers). "DEMO_MAP_ID" works for development only.
    google_maps_map_id: str = ""

    upload_dir: Path = BASE_DIR / "uploads"
    max_upload_mb: int = 8
    data_dir: Path = BASE_DIR / "data"
    model_dir: Path = BASE_DIR / "models"

    # Demo mode exposes the demo account picker and the reset-demo-data endpoint.
    demo_mode: bool = True
    rate_limit_reports_per_10min: int = 10

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
