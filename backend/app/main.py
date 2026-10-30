import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import User
from .routers import admin, auth, dashboard, hazards, maintenance, notifications, places, routes, traffic
from .security import decode_token
from .services.graph import get_network
from .services.realtime import manager
from .services.traffic_model import get_forecaster

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    manager.loop = asyncio.get_running_loop()
    # warm caches so the first route request is fast
    await asyncio.to_thread(lambda: (get_network("walk"), get_network("drive"), get_forecaster()))
    yield


app = FastAPI(title="SafeRoute AI API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth, places, hazards, routes, traffic, dashboard, maintenance, notifications, admin):
    app.include_router(r.router)
settings.upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_configured": bool(settings.anthropic_api_key), "demo_mode": settings.demo_mode,
            "realtime_connections": sum(len(v) for v in manager.by_user.values())}


@app.websocket("/ws/alerts")
async def alerts(ws: WebSocket, token: str = Query(...)):
    try:
        uid = decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    with SessionLocal() as db:
        if not db.get(User, uid):
            await ws.close(code=4401)
            return
    await manager.connect(uid, ws)
    try:
        await ws.send_json({"event": "connected", "data": {"user_id": uid}})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"event":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(uid, ws)


# Single-service deployment: serve the built React app; unknown paths fall back to index.html (client routing).
# Registered last so /api, /ws, /uploads and /docs keep priority.
if settings.web_dir and (settings.web_dir / "index.html").is_file():
    web_root = settings.web_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "ws/", "uploads/")):
            raise HTTPException(404, "Not found")
        f = (web_root / path).resolve()
        if path and f.is_file() and web_root in f.parents:
            return FileResponse(f)
        return FileResponse(web_root / "index.html")
