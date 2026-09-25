import pytest
import respx
import httpx
import os
import json
import database
import routers.chat as chat_router
import routers.projects as projects_router

pytestmark = pytest.mark.asyncio

# --- 1. CHAT & MESSAGE HISTORY ---
async def test_chat_history_lifecycle(api_client):
    res = await api_client.delete("/api/chat/history")
    assert res.status_code == 200

    test_messages = [
        {"role": "user", "content": "Message 1", "created_at": "2026-09-25T10:00:00"},
        {"role": "assistant", "content": "Reply 1", "created_at": "2026-09-25T10:00:01"},
        {"role": "user", "content": "Message 2", "created_at": "2026-09-25T10:00:02"}
    ]
    await database.db.chat_threads.update_one(
        {"thread_id": "global_chat"},
        {"$set": {"messages": test_messages}},
        upsert=True
    )

    res = await api_client.get("/api/chat/history")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3

    res = await api_client.delete("/api/chat/messages/1")
    assert res.status_code == 200
    assert res.json()["remaining"] == 2

    res = await api_client.get("/api/chat/history")
    data = res.json()
    assert len(data) == 2
    assert data[0]["content"] == "Message 1"
    assert data[1]["content"] == "Message 2"

# --- 2. INTENT: PROJECT CREATION ---
async def test_project_creation_from_chat_intent(api_client):
    payload = {
        "messages": [{"role": "user", "content": "создай докер проект test-shop"}]
    }
    async with api_client.stream("POST", "/api/chat/completions", json=payload) as res:
        assert res.status_code == 200
        async for line in res.aiter_lines():
            if "project_created" in line:
                break

    workspace_dir = chat_router.WORKSPACE_DIR
    proj_dir = os.path.join(workspace_dir, "test-shop")
    assert os.path.exists(proj_dir)
    assert os.path.exists(os.path.join(proj_dir, "docker-compose.yml"))

# --- 3. SAVE IMAGE TO PROJECT DIRECTORY ---
@respx.mock
async def test_save_image_to_project_directory(api_client):
    workspace_dir = chat_router.WORKSPACE_DIR
    proj_dir = os.path.join(workspace_dir, "landing_test")
    os.makedirs(proj_dir, exist_ok=True)

    fake_png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
    respx.get("http://host.docker.internal:8188/view").mock(
        return_value=httpx.Response(200, content=fake_png_bytes)
    )

    payload = {
        "image_url": "http://localhost:8000/api/chat/image/view?filename=test.png&subfolder=&type=output",
        "target_dir": "assets/images",
        "filename": "hero.png"
    }
    res = await api_client.post("/api/projects/landing_test/save-image", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["file_path"] == "assets/images/hero.png"

    saved_file = os.path.join(proj_dir, "assets", "images", "hero.png")
    assert os.path.exists(saved_file)
    with open(saved_file, "rb") as f:
        assert f.read() == fake_png_bytes

# --- 4. COMFYUI INTERRUPT ---
@respx.mock
async def test_interrupt_generation(api_client):
    respx.post("http://host.docker.internal:8188/interrupt").mock(
        return_value=httpx.Response(200, json={})
    )
    res = await api_client.post("/api/chat/interrupt")
    assert res.status_code == 200
    assert res.json()["status"] == "interrupted"

# --- 5. PROJECT TREE & SUBPATHS ---
async def test_project_tree_navigation(api_client):
    workspace_dir = chat_router.WORKSPACE_DIR
    proj_dir = os.path.join(workspace_dir, "tree_project")
    sub_dir = os.path.join(proj_dir, "src", "utils")
    os.makedirs(sub_dir, exist_ok=True)

    with open(os.path.join(proj_dir, "README.md"), "w") as f:
        f.write("# Hello")
    with open(os.path.join(sub_dir, "helper.py"), "w") as f:
        f.write("def help(): pass")

    # Корневое дерево
    res = await api_client.get("/api/projects/tree_project/tree")
    assert res.status_code == 200
    tree = res.json()
    names = [node["name"] for node in tree]
    assert "README.md" in names
    assert "src" in names

    # Вложенная папка
    res_sub = await api_client.get("/api/projects/tree_project/tree?subpath=src")
    assert res_sub.status_code == 200
    sub_tree = res_sub.json()
    assert any(n["name"] == "utils" for n in sub_tree)

# --- 6. FILE CRUD & REVISION HISTORY ---
async def test_file_read_write_and_history(api_client):
    workspace_dir = chat_router.WORKSPACE_DIR
    proj_dir = os.path.join(workspace_dir, "crud_project")
    os.makedirs(proj_dir, exist_ok=True)

    file_rel = "app.py"
    file_full = os.path.join(proj_dir, file_rel)

    # 1. Запись файла
    save_payload = {"path": file_rel, "content": "print('v1')"}
    res = await api_client.post("/api/projects/crud_project/file", json=save_payload)
    assert res.status_code == 200

    # 2. Чтение файла
    res_read = await api_client.get(f"/api/projects/crud_project/file?path={file_rel}")
    assert res_read.status_code == 200
    assert res_read.json()["content"] == "print('v1')"

    # 3. Перезапись (v2) для создания ревизии
    save_payload_v2 = {"path": file_rel, "content": "print('v2')"}
    await api_client.post("/api/projects/crud_project/file", json=save_payload_v2)

    # 4. Проверка истории файла
    res_hist = await api_client.get(f"/api/projects/crud_project/history?path={file_rel}")
    assert res_hist.status_code == 200
    history = res_hist.json()
    assert len(history) >= 1

    # 5. Очистка истории файла
    res_clear = await api_client.delete(f"/api/projects/crud_project/history?path={file_rel}")
    assert res_clear.status_code == 200
    res_hist_after = await api_client.get(f"/api/projects/crud_project/history?path={file_rel}")
    assert len(res_hist_after.json()) == 0

# --- 7. AGENT SESSION & MESSAGE DELETION ---
async def test_agent_message_management(api_client):
    proj = "agent_test_proj"
    test_session = {
        "project_name": proj,
        "messages": [
            {"role": "user", "content": "Refactor code"},
            {"role": "assistant", "content": "Refactored successfully"}
        ]
    }
    await database.db.agent_sessions.update_one(
        {"project_name": proj},
        {"$set": test_session},
        upsert=True
    )

    res = await api_client.get(f"/api/agent/{proj}/history")
    assert res.status_code == 200
    assert len(res.json()) == 2

    # Удаление сообщения агента
    res_del = await api_client.delete(f"/api/agent/{proj}/messages/0")
    assert res_del.status_code == 200

    res_after = await api_client.get(f"/api/agent/{proj}/history")
    assert len(res_after.json()) == 1
    assert res_after.json()[0]["role"] == "assistant"

# --- 8. AGENT EXECUTION STREAM WITH ACTIVE FILE ---
@respx.mock
async def test_agent_execute_stream(api_client):
    proj = "agent_exec_proj"
    workspace_dir = chat_router.WORKSPACE_DIR
    os.makedirs(os.path.join(workspace_dir, proj), exist_ok=True)

    # Мокаем Ollama API
    respx.post("http://host.docker.internal:11434/api/chat").mock(
        return_value=httpx.Response(200, json={
            "message": {"role": "assistant", "content": "Here is the code"}
        })
    )

    payload = {
        "project_name": proj,
        "prompt": "Add healthcheck",
        "active_file_path": "main.py",
        "active_file_content": "from fastapi import FastAPI\napp = FastAPI()"
    }

    async with api_client.stream("POST", "/api/agent/execute", json=payload) as res:
        assert res.status_code == 200
        events = []
        async for line in res.aiter_lines():
            if line.startswith("data:"):
                events.append(line)
        assert len(events) > 0
