import asyncio
import json
from typing import Dict, Set

class ProjectEventBus:
    def __init__(self):
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}

    def subscribe(self, project: str) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        if project not in self._subscribers:
            self._subscribers[project] = set()
        self._subscribers[project].add(q)
        return q

    def unsubscribe(self, project: str, q: asyncio.Queue):
        if project in self._subscribers:
            self._subscribers[project].discard(q)
            if not self._subscribers[project]:
                del self._subscribers[project]

    async def emit(self, project: str, event_data: dict):
        # Отправляем конкретному проекту и глобальным подписчикам ("*")
        targets = set()
        if project in self._subscribers:
            targets.update(self._subscribers[project])
        if "*" in self._subscribers:
            targets.update(self._subscribers["*"])

        for q in targets:
            try:
                q.put_nowait(event_data)
            except asyncio.QueueFull:
                pass

project_event_bus = ProjectEventBus()
