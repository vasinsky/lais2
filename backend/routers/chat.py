import os
import re
import json
import httpx
import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from sse_starlette.sse import EventSourceResponse
import database
from .projects import init_project_structure

router = APIRouter()
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/workspace")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")

TRANSLATOR_MODEL = "dolphin-llama3:latest"
VISION_MODEL = "minicpm-v:latest"
DEFAULT_CODER_MODEL = "qwen2.5-coder:7b-instruct-q4_K_M"

class ChatMessage(BaseModel):
    role: str
    content: str
    images: Optional[List[str]] = None
    modelUsed: Optional[str] = None

class ChatPayload(BaseModel):
    model: Optional[str] = None
    messages: List[ChatMessage]
    stream: Optional[bool] = True

def parse_project_creation_intent(text: str):
    raw = text.strip()
    lower = raw.lower()

    # 1. Проверяем, есть ли запрос на создание
    trigger_words = ["создай", "создать", "сделай", "новый проект", "create", "new"]
    if not any(w in lower for w in trigger_words):
        return None

    # 2. Определяем тип проекта по контексту
    ptype = "static"
    if any(k in lower for k in ["докер", "docker"]):
        ptype = "docker"
    elif any(k in lower for k in ["пайтон", "python", "питон"]):
        ptype = "python"
    elif any(k in lower for k in ["статич", "static", "лендинг", "landing", "веб", "web"]):
        ptype = "static"

    # 3. Извлекаем название проекта (строго после слова "проект" или "project")
    # Поддерживаем буквы, цифры, дефис '-' и лоу дэш '_'
    match = re.search(r"(?:проект|project)\s+([a-zA-Z0-9_\-]+)", raw, re.IGNORECASE)
    if match:
        proj_name = match.group(1).strip()
        return {"name": proj_name, "project_type": ptype}

    # Если слово "проект" пропущено, берем последнее валидное имя
    fallback_match = re.search(r"(?:создай|создать|сделай|create|new)\s+(?:статичный|статический|докер|docker|пайтон|python|питон|лендинг|landing)?\s*([a-zA-Z0-9_\-]+)", raw, re.IGNORECASE)
    if fallback_match:
        candidate = fallback_match.group(1).strip()
        stop_words = {"статичный", "статический", "докер", "docker", "пайтон", "python", "питон", "проект", "project", "landing", "лендинг"}
        if candidate.lower() not in stop_words:
            return {"name": candidate, "project_type": ptype}

    return None

async def translate_text_to_english(text: str, client: httpx.AsyncClient) -> str:
    if not text.strip():
        return ""
    prompt = (
        "You are an expert bilingual technical translator. Translate the following user message to clear, precise English. "
        "Preserve code snippets and programming terms exactly. Output ONLY the English translation, no chit-chat:\n\n" + text
    )
    try:
        res = await client.post(f"{OLLAMA_URL}/api/generate", json={
            "model": TRANSLATOR_MODEL,
            "prompt": prompt,
            "stream": False
        }, timeout=40.0)
        if res.status_code == 200:
            return res.json().get("response", "").strip() or text
    except Exception:
        pass
    return text

async def analyze_vision_to_english(text: str, images: List[str], client: httpx.AsyncClient) -> str:
    prompt = (
        f"Analyze this image in detail for software development context. "
        f"User question: {text}\n"
        "Provide a comprehensive technical description of the image content and translate the user request into English. "
        "Output ONLY the English technical description and query:"
    )
    try:
        res = await client.post(f"{OLLAMA_URL}/api/generate", json={
            "model": VISION_MODEL,
            "prompt": prompt,
            "images": images,
            "stream": False
        }, timeout=60.0)
        if res.status_code == 200:
            return res.json().get("response", "").strip() or text
    except Exception:
        pass
    return text

@router.get("/history")
async def get_global_history():
    if database.db is None:
        return []
    thread = await database.db.chat_threads.find_one({"thread_id": "global_chat"})
    return thread.get("messages", []) if thread else []

@router.delete("/history")
async def clear_global_history():
    if database.db is not None:
        await database.db.chat_threads.delete_one({"thread_id": "global_chat"})
    return {"status": "cleared"}

@router.post("/completions")
async def chat_stream(payload: ChatPayload):
    target_model = payload.model or DEFAULT_CODER_MODEL
    has_images = any(m.images and len(m.images) > 0 for m in payload.messages)
    last_user_msg = payload.messages[-1]

    project_intent = parse_project_creation_intent(last_user_msg.content)

    if project_intent:
        proj_name = project_intent["name"]
        proj_type = project_intent["project_type"]
        proj_path = os.path.join(WORKSPACE_DIR, proj_name)

        if not os.path.exists(proj_path):
            init_project_structure(proj_path, proj_name, proj_type)

        if database.db is not None:
            await database.db.project_settings.update_one(
                {"project_name": proj_name},
                {"$set": {
                    "project_name": proj_name,
                    "project_type": proj_type,
                    "is_hidden": False,
                    "created_at": datetime.datetime.utcnow().isoformat()
                }},
                upsert=True
            )

            now_iso = datetime.datetime.utcnow().isoformat()
            agent_init_reply = f"Проект `{proj_name}` ({proj_type}) успешно создан. Контекст загружен."
            await database.db.agent_sessions.update_one(
                {"project_name": proj_name},
                {"$push": {"messages": {
                    "$each": [
                        {"role": "user", "content": last_user_msg.content, "created_at": now_iso},
                        {"role": "assistant", "content": agent_init_reply, "modelUsed": target_model, "created_at": now_iso}
                    ]
                }}, "$set": {"updated_at": now_iso}},
                upsert=True
            )

        default_file = "index.html" if proj_type == "static" else ("docker-compose.yml" if proj_type == "docker" else "main.py")

        async def create_event():
            yield {"data": json.dumps({"type": "meta", "model": target_model})}
            yield {"data": json.dumps({
                "type": "project_created",
                "project_name": proj_name,
                "project_type": proj_type,
                "default_file": default_file
            })}
        return EventSourceResponse(create_event())

    cursor = database.db.system_prompts.find({"is_active": True})
    active_rules = []
    async for doc in cursor:
        p = doc.get("prompt", "").strip()
        if p:
            active_rules.append(p)
    global_rules_text = "\n\n".join(active_rules)

    now_iso = datetime.datetime.utcnow().isoformat()
    await database.db.chat_threads.update_one(
        {"thread_id": "global_chat"},
        {"$push": {"messages": {             "role": "user",             "content": last_user_msg.content,             "images": last_user_msg.images,             "created_at": now_iso         }}, "$set": {"updated_at": now_iso}},
        upsert=True
    )

    async def event_generator():
        yield {"data": json.dumps({"type": "meta", "model": target_model})}

        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            if has_images and last_user_msg.images:
                english_user_prompt = await analyze_vision_to_english(last_user_msg.content, last_user_msg.images, client)
            else:
                english_user_prompt = await translate_text_to_english(last_user_msg.content, client)

            system_instruction = (
                "You are an expert AI software developer.\n"
                f"Global Rules:\n{global_rules_text}\n\n"
                "MANDATORY LANGUAGE RULE:\n"
                "Explain your thoughts, answers, and conversation strictly in RUSSIAN, "
                "while writing clean, production-ready code in standard formats."
            )

            processed_messages = [{"role": "system", "content": system_instruction}]
            for m in payload.messages[:-1]:
                processed_messages.append({"role": m.role, "content": m.content})
            processed_messages.append({"role": "user", "content": english_user_prompt})

            assistant_full_reply = ""
            req_body = {
                "model": target_model,
                "messages": processed_messages,
                "stream": True,
                "options": {"num_ctx": 16384, "temperature": 0.4}
            }
            try:
                async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=req_body) as response:
                    async for chunk in response.aiter_lines():
                        if chunk:
                            try:
                                d = json.loads(chunk)
                                token = d.get("message", {}).get("content", "")
                                assistant_full_reply += token
                            except Exception:
                                pass
                            yield {"data": chunk}
            except Exception as e:
                yield {"data": json.dumps({"error": str(e)})}

            if assistant_full_reply:
                await database.db.chat_threads.update_one(
                    {"thread_id": "global_chat"},
                    {"$push": {"messages": {
                        "role": "assistant",
                        "content": assistant_full_reply,
                        "modelUsed": target_model,
                        "created_at": datetime.datetime.utcnow().isoformat()
                    }}}
                )

    return EventSourceResponse(event_generator())
