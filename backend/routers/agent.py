import os
import json
import httpx
import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import database

router = APIRouter()
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/workspace")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")

MANDATORY_RUSSIAN_DIRECTIVE = (
    "MANDATORY LANGUAGE DIRECTIVE: You MUST ALWAYS respond strictly and fluently in RUSSIAN by default, "
    "unless explicitly instructed by the user to respond in another language. "
    "All code explanations, responses, and reasoning must be in Russian."
)

class AgentTask(BaseModel):
    project_name: str
    prompt: str
    model: str

# 1. История сессии конкретного проекта
@router.get("/{project_name}/history")
async def get_agent_history(project_name: str):
    try:
        session = await database.db.agent_sessions.find_one({"project_name": project_name})
        if not session:
            return []
        return session.get("messages", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. Очистка истории сессии агента проекта
@router.delete("/{project_name}/history")
async def clear_agent_history(project_name: str):
    try:
        await database.db.agent_sessions.delete_one({"project_name": project_name})
        return {"status": "cleared", "project_name": project_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. Выполнение задачи агента с сохранением в историю проекта
@router.post("/execute")
async def execute_agent_task(task: AgentTask):
    proj_path = os.path.join(WORKSPACE_DIR, task.project_name)
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")

    files_summary = []
    for root, _, files in os.walk(proj_path):
        for f in files:
            if not f.startswith('.'):
                rel = os.path.relpath(os.path.join(root, f), proj_path)
                files_summary.append(rel)

    cursor = database.db.system_prompts.find({"is_active": True})
    all_rules = [MANDATORY_RUSSIAN_DIRECTIVE]
    async for doc in cursor:
        p = doc.get("prompt", "").strip()
        if p:
            all_rules.append(p)
            
    global_memory = "\n\n".join(all_rules)

    system_instruction = (
        f"You are an autonomous senior developer working inside project: {task.project_name}.\n\n"
        f"Global Directives:\n{global_memory}\n\n"
        f"Workspace files: {json.dumps(files_summary[:100])}\n"
        "Inspect structure and fulfill requested code changes accurately."
    )

    # Загружаем предыдущие сообщения проекта для непрерывного контекста
    session = await database.db.agent_sessions.find_one({"project_name": task.project_name})
    history_msgs = session.get("messages", []) if session else []

    dialog_history = [{"role": "system", "content": system_instruction}]
    for h in history_msgs[-10:]:
        dialog_history.append({"role": h["role"], "content": h["content"]})
    
    dialog_history.append({"role": "user", "content": task.prompt})

    # Сохраняем запрос пользователя
    user_record = {
        "role": "user",
        "content": task.prompt,
        "created_at": datetime.datetime.utcnow().isoformat()
    }
    await database.db.agent_sessions.update_one(
        {"project_name": task.project_name},
        {"$push": {"messages": user_record}, "$set": {"updated_at": datetime.datetime.utcnow().isoformat()}},
        upsert=True
    )

    async def event_generator():
        yield {"data": json.dumps({"type": "meta", "model": task.model})}

        assistant_full_reply = ""
        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            payload = {
                "model": task.model,
                "messages": dialog_history,
                "stream": True
            }
            try:
                async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
                    async for chunk in resp.aiter_lines():
                        if chunk:
                            try:
                                data = json.loads(chunk)
                                token = data.get("message", {}).get("content", "")
                                assistant_full_reply += token
                            except Exception:
                                pass
                            yield {"data": chunk}
            except Exception as e:
                yield {"data": json.dumps({"error": str(e)})}

        # Сохраняем ответ ассистента в историю агента
        if assistant_full_reply:
            assistant_record = {
                "role": "assistant",
                "content": assistant_full_reply,
                "modelUsed": task.model,
                "created_at": datetime.datetime.utcnow().isoformat()
            }
            await database.db.agent_sessions.update_one(
                {"project_name": task.project_name},
                {"$push": {"messages": assistant_record}}
            )

    return EventSourceResponse(event_generator())
