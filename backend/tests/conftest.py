import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="saferoute-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["RATE_LIMIT_REPORTS_PER_10MIN"] = "1000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.seed import run  # noqa: E402
from app.services.graph import get_places  # noqa: E402

PLACES = {p["name"]: p for p in get_places()}
MMU = {"lat": PLACES["Multimedia University"]["lat"], "lon": PLACES["Multimedia University"]["lon"]}
MALL = {"lat": PLACES["DPulze Shopping Centre"]["lat"], "lon": PLACES["DPulze Shopping Centre"]["lon"]}
HOSPITAL = {"lat": PLACES["Hospital Cyberjaya"]["lat"], "lon": PLACES["Hospital Cyberjaya"]["lon"]}


@pytest.fixture(scope="session", autouse=True)
def seeded():
    run()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _login(c, email):
    r = c.post("/api/auth/login", json={"email": email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def users(client):
    return {
        "a": _login(client, "student.a@demo.saferoute.my"),
        "b": _login(client, "student.b@demo.saferoute.my"),
        "driver": _login(client, "driver@demo.saferoute.my"),
        "op": _login(client, "operator@demo.saferoute.my"),
        "maint": _login(client, "maintenance@demo.saferoute.my"),
    }
