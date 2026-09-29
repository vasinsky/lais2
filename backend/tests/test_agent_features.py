import pytest
import json
import os
import shutil
from unittest.mock import patch, AsyncMock, MagicMock
from routers.projects import get_base_dir
from unittest.mock import patch, AsyncMock, MagicMock
from services.mcp_client import mcp_client

TEST_PROJECT = "TestAgentProject"

@pytest.fixture(autouse=True)
def setup_test_project():
    orig_list = mcp_client.list_files
    orig_write = mcp_client.write_file

    async def mock_write(project, path, content):
        full_p = os.path.join(get_base_dir(), project, path)
        os.makedirs(os.path.dirname(full_p), exist_ok=True)
        with open(full_p, "w", encoding="utf-8") as f:
            f.write(content)
        return {"status": "ok"}

    mcp_client.list_files = AsyncMock(return_value=[{"path": "index.html", "is_dir": False}, {"path": "style.css", "is_dir": False}])
    mcp_client.write_file = AsyncMock(side_effect=mock_write)
    proj_dir = os.path.join(get_base_dir(), TEST_PROJECT)
    os.makedirs(proj_dir, exist_ok=True)
    
    with open(os.path.join(proj_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write("<!DOCTYPE html><html><body><h1>Old</h1></body></html>")
    with open(os.path.join(proj_dir, "style.css"), "w", encoding="utf-8") as f:
        f.write("body { margin: 0; }")

    yield

    if os.path.exists(proj_dir):
        shutil.rmtree(proj_dir, ignore_errors=True)


def create_mock_stream_context(chunks):
    async def mock_aiter_lines():
        for ch in chunks:
            yield ch

    mock_resp = MagicMock()
    mock_resp.aiter_lines = mock_aiter_lines

    class MockStreamContext:
        async def __aenter__(self):
            return mock_resp
        async def __aexit__(self, exc_type, exc, tb):
            pass

    return MockStreamContext()


@pytest.mark.asyncio
async def test_agent_realtime_code_streaming_contract(api_client):
    """
    1. Проверка стриминга кода напрямую в редактор (SSE: stream_code).
    """
    mock_chunks = [
        json.dumps({"message": {"content": "<!DOCTYPE html>\n"}}),
        json.dumps({"message": {"content": "<html><body><h1>Баня под ключ</h1></body></html>"}}),
    ]

    mock_client = MagicMock()
    mock_client.stream.return_value = create_mock_stream_context(mock_chunks)
    mock_client.post = AsyncMock()

    with patch("services.agent_handlers.file_ops.httpx.AsyncClient") as mock_http:
        mock_http.return_value.__aenter__.return_value = mock_client

        events = []
        async with api_client.stream("POST", "/api/agent/execute", json={
            "project_name": TEST_PROJECT,
            "prompt": "Наполни главную страницу index.html информацией о строительстве бань",
            "model": "qwen2.5-coder:7b-instruct-q4_K_M"
        }) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str and data_str != "[DONE]":
                        try:
                            events.append(json.loads(data_str))
                        except Exception:
                            pass

        stream_code_events = [e for e in events if e.get("type") == "stream_code"]
        assert len(stream_code_events) >= 2
        assert stream_code_events[0].get("path") == "index.html"
        assert stream_code_events[0].get("is_start") is True

        file_saved_events = [e for e in events if e.get("type") == "file_saved"]
        assert len(file_saved_events) > 0
        assert file_saved_events[0].get("path") == "index.html"
        assert "revision" in file_saved_events[0]

        target_path = os.path.join(get_base_dir(), TEST_PROJECT, "index.html")
        with open(target_path, "r", encoding="utf-8") as f:
            saved_content = f.read()
        assert "Баня под ключ" in saved_content


@pytest.mark.asyncio
async def test_agent_comfyui_image_intent_and_generation(api_client):
    """
    2. Проверка генерации изображений через ComfyUI и прогресса (image_progress).
    """
    prompt = "Нарисуй красивую деревянную баню в лесу и сохрани в images/banya.png"

    async def mock_generate_image_stream(eng_desc, ckpt):
        yield {"type": "image_progress", "step": 10, "total": 20, "percent": 50, "status": "Sampling"}
        yield {"type": "image_complete", "filename": "temp_banya.png", "subfolder": ""}

    mock_chunks = [
        json.dumps({"message": {"content": "Картинка успешно создана и сохранена."}})
    ]

    mock_img_response = MagicMock()
    mock_img_response.status_code = 200
    mock_img_response.content = b"\x89PNG\r\n\x1a\nfake_image_bytes"

    mock_stream_ctx = create_mock_stream_context(mock_chunks)

    def mock_async_client_factory(*args, **kwargs):
        client_instance = MagicMock()
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=None)
        client_instance.get = AsyncMock(return_value=mock_img_response)
        client_instance.post = AsyncMock()
        client_instance.stream.return_value = mock_stream_ctx
        return client_instance

    mock_trans_resp = MagicMock()
    mock_trans_resp.status_code = 200
    mock_trans_resp.json.return_value = {"response": "A beautiful wooden bathhouse in the forest"}

    def mock_async_client_factory_fixed(*args, **kwargs):
        c = mock_async_client_factory(*args, **kwargs)
        c.post = AsyncMock(return_value=mock_trans_resp)
        return c

    with patch("services.agent_handlers.image_gen.generate_image_stream", side_effect=mock_generate_image_stream), \
         patch("services.agent_handlers.image_gen.httpx.AsyncClient", side_effect=mock_async_client_factory_fixed):

        events = []
        async with api_client.stream("POST", "/api/agent/execute", json={
            "project_name": TEST_PROJECT,
            "prompt": prompt,
            "model": "qwen2.5-coder:7b-instruct-q4_K_M"
        }) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str and data_str != "[DONE]":
                        try:
                            events.append(json.loads(data_str))
                        except Exception:
                            pass

        progress_events = [e for e in events if e.get("type") == "image_progress"]
        assert len(progress_events) > 0, "Должно прийти событие image_progress"
        assert progress_events[0].get("percent") == 50

        saved_img_events = [e for e in events if e.get("type") == "file_saved" and "images/banya.png" in e.get("path", "")]
        assert len(saved_img_events) > 0, "Изображение должно быть сохранено"

        expected_img_file = os.path.join(get_base_dir(), TEST_PROJECT, "images", "banya.png")
        assert os.path.exists(expected_img_file), "Файл картинки должен появиться на диске"


@pytest.mark.asyncio
async def test_agent_vision_analysis_pipeline(api_client):
    """
    3. Проверка распознавания прикрепленных картинок (Vision -> перевод в контекст агента).
    """
    mock_chunks = [
        json.dumps({"message": {"content": "Анализ изображения завершен."}})
    ]

    mock_client = MagicMock()
    mock_client.stream.return_value = create_mock_stream_context(mock_chunks)
    mock_client.post = AsyncMock()

    with patch("services.agent_handlers.vision_handlers.httpx.AsyncClient") as mock_http:
        mock_http.return_value.__aenter__.return_value = mock_client

        events = []
        async with api_client.stream("POST", "/api/agent/execute", json={
            "project_name": TEST_PROJECT,
            "prompt": "Что изображено на этой схеме?",
            "images": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
            "model": "qwen2.5-coder:7b-instruct-q4_K_M"
        }) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str and data_str != "[DONE]":
                        try:
                            events.append(json.loads(data_str))
                        except Exception:
                            pass

        assert response.status_code == 200
        mock_client.stream.assert_called_once()
