import os
import bson
import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
from sse_starlette.sse import EventSourceResponse

import database
from services.mcp_client import mcp_client
from services.intent_router import classify_intent, IntentType
from services.agent_handlers import (
    ChatQAHandler,
    FileOpsHandler,
    ImageGenHandler,
    VisionQAHandler,
    ImageToImageHandler
)

router = APIRouter()

WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/projects")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
DEFAULT_CODER_MODEL = os.getenv("DEFAULT_CODER_MODEL", "qwen2.5-coder:7b-instruct-q4_K_M")

# Инициализация обработчиков
handlers = {
    IntentType.CHAT_QA: ChatQAHandler(OLLAMA_URL, DEFAULT_CODER_MODEL),
    IntentType.FILE_OPS: FileOpsHandler(OLLAMA_URL, DEFAULT_CODER_MODEL),
    IntentType.IMAGE_GEN: ImageGenHandler(OLLAMA_URL),
    IntentType.VISION_QA: VisionQAHandler(OLLAMA_URL),
    IntentType.IMAGE_TO_IMAGE: ImageToImageHandler(OLLAMA_URL)
}

class AgentTask(BaseModel):
    project_name: str
    prompt: str
    model: Optional[str] = None
    images: Optional[List[str]] = None
    active_file_path: Optional[str] = None
    active_file_content: Optional[str] = None
    comfy_checkpoint: Optional[str] = None

@router.get("/{project_name}/history")
async def get_agent_history(project_name: str):
    session = await database.db.agent_sessions.find_one({"project_name": project_name}) if database.db is not None else None
    return session.get("messages", []) if session else []

@router.delete("/{project_name}/messages/{message_index}")
async def delete_agent_message(project_name: str, message_index: int):
    if database.db is None:
        return {"status": "error", "message": "No database"}
    session = await database.db.agent_sessions.find_one({"project_name": project_name})
    if not session or "messages" not in session:
        return {"status": "not_found"}
    msgs = session["messages"]
    if 0 <= message_index < len(msgs):
        msgs.pop(message_index)
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        await database.db.agent_sessions.update_one(
            {"project_name": project_name},
            {"$set": {"messages": msgs, "updated_at": now_iso}}
        )
        return {"status": "deleted", "remaining": len(msgs)}
    return {"status": "index_out_of_range"}

@router.delete("/{project_name}/history")
async def clear_agent_history(project_name: str):
    if database.db is not None:
        await database.db.agent_sessions.delete_one({"project_name": project_name})
    return {"status": "cleared", "project_name": project_name}

@router.get("/{project_name}/stats")
async def get_agent_stats(project_name: str):
    if database.db is None:
        return {"msg_count": 0, "size_kb": 0.0, "size_bytes": 0}
    session = await database.db.agent_sessions.find_one({"project_name": project_name})
    if not session:
        return {"msg_count": 0, "size_kb": 0.0, "size_bytes": 0}
    raw_bytes = len(bson.BSON.encode(session))
    msgs = session.get("messages", [])
    return {
        "msg_count": len(msgs),
        "size_bytes": raw_bytes,
        "size_kb": round(raw_bytes / 1024, 2)
    }

@router.post("/execute")
async def execute_agent_task(task: AgentTask):
    target_model = task.model or DEFAULT_CODER_MODEL
    has_imgs = bool(task.images and len(task.images) > 0)

    # Получаем дерево файлов проекта
    try:
        mcp_items = await mcp_client.list_files(task.project_name)
        file_tree = [item["path"] for item in mcp_items if not item.get("is_dir", False)]
    except Exception:
        file_tree = []

    # 1. Маршрутизация намерения
    intent_data = classify_intent(
        prompt=task.prompt,
        has_images=has_imgs,
        active_file_path=task.active_file_path,
        is_agent_mode=True
    )
    intent_data["file_tree"] = file_tree
    agent_intent = intent_data["intent"]

    # 2. Фиксация сообщения пользователя в сессии
    now_iso = datetime.datetime.utcnow().isoformat()
    if database.db is not None:
        await database.db.agent_sessions.update_one(
            {"project_name": task.project_name},
            {"$push": {"messages": {"role": "user", "content": task.prompt, "images": task.images, "created_at": now_iso}}, "$set": {"updated_at": now_iso}},
            upsert=True
        )

    # 3. Выбор обработчика по типу события
    handler = handlers.get(agent_intent, handlers[IntentType.CHAT_QA])

    async def event_stream():
        import json
        yield {"data": json.dumps({"type": "meta", "model": target_model, "intent": agent_intent.value})}
        async for event in handler.handle(task, intent_data):
            yield event

    return EventSourceResponse(event_stream(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
