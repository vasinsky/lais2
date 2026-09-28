import pytest
from httpx import AsyncClient, ASGITransport
from fastapi.testclient import TestClient
from main import app

@pytest.mark.asyncio
async def test_system_model_info_endpoint():
    """Проверка эндпоинта контекста модели"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/system/model-info", params={"model": "qwen2.5-coder:7b-instruct-q4_K_M"})
        assert res.status_code == 200
        data = res.json()
        assert "context_length" in data
        assert "model" in data
        assert isinstance(data["context_length"], int)

@pytest.mark.asyncio
async def test_chat_stats_endpoint():
    """Проверка отдачи статистики глобального чата"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/chat/stats")
        assert res.status_code == 200
        data = res.json()
        assert "msg_count" in data
        assert "size_kb" in data

@pytest.mark.asyncio
async def test_agent_stats_endpoint():
    """Проверка отдачи статистики агента проекта"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/agent/landing1/stats")
        assert res.status_code == 200
        data = res.json()
        assert "msg_count" in data
        assert "size_kb" in data

def test_terminal_websocket_connection():
    """Проверка WebSocket соединения псевдотерминала"""
    client = TestClient(app)
    with client.websocket_connect("/api/terminal/ws?mode=chat") as websocket:
        websocket.send_text("__RESIZE__:80:24")
        websocket.send_text("echo 'hello studio'\n")
        data = websocket.receive_text()
        assert len(data) > 0
