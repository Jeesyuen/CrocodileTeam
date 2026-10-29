"""WebSocket connection manager and event bus.

Request handlers are synchronous (SQLAlchemy), so they publish through
`publish()` which hands the coroutine to the server's event loop.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import WebSocket

log = logging.getLogger("saferoute.realtime")


class ConnectionManager:
    def __init__(self):
        self.by_user: dict[int, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.by_user[user_id].add(ws)

    def disconnect(self, user_id: int, ws: WebSocket):
        self.by_user[user_id].discard(ws)
        if not self.by_user[user_id]:
            self.by_user.pop(user_id, None)

    @property
    def online_users(self) -> list[int]:
        return list(self.by_user)

    async def _send(self, ws: WebSocket, msg: str, user_id: int):
        try:
            await ws.send_text(msg)
        except Exception:  # client went away mid-send
            self.disconnect(user_id, ws)

    async def _dispatch(self, event: str, data: dict, user_ids: list[int] | None):
        msg = json.dumps({"event": event, "data": data, "ts": datetime.now(timezone.utc).isoformat()}, default=str)
        targets = self.by_user.items() if user_ids is None else [(u, self.by_user.get(u, set())) for u in user_ids]
        await asyncio.gather(*(self._send(ws, msg, u) for u, sockets in list(targets) for ws in list(sockets)),
                             return_exceptions=True)

    def publish(self, event: str, data: dict, user_ids: list[int] | None = None):
        """Thread-safe: broadcast to everyone (user_ids=None) or to specific users."""
        if self.loop is None or self.loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        coro = self._dispatch(event, data, user_ids)
        if running is self.loop:
            self.loop.create_task(coro)
        else:
            asyncio.run_coroutine_threadsafe(coro, self.loop)


manager = ConnectionManager()
