import os
import json
import httpx
import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sse_starlette.sse import EventSourceResponse
import database

router = APIRouter()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")

# Директива: отвечать строго на русском по умолчанию
MANDATORY_RUSSIAN_DIRECTIVE = (
    "MANDATORY LANGUAGE DIRECTIVE: You MUST ALWAYS respond strictly and fluently in RUSSIAN by default, "
    "unless explicitly instructed by the user to respond in another language. "
    "All explanations, comments, and conversation must be in Russian."
)

class ChatMessage(BaseModel):
    role: str
    content: str
    images: Optional[List[str]] = None
    modelUsed: Optional[str] = None

class ChatPayload(BaseModel):
    model: Optional[str] = "dolphin-llama3:latest"
    messages: List[ChatMessage]
    stream: Optional[bool] = True

# 1. Получение истории сообщений Global Chat
@router.get("/history")
async def get_global_history():
    try:
        thread = await database.db.chat_threads.find_one({"thread_id": "global_chat"})
        if not thread:
            return []
        return thread.get("messages", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. Очистка истории сообщений Global Chat
@router.delete("/history")
async def clear_global_history():
    try:
        await database.db.chat_threads.delete_one({"thread_id": "global_chat"})
        return {"status": "cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. Отправка сообщения и стриминг с сохранением в базу
@router.post("/completions")
async def chat_stream(payload: ChatPayload):
    has_images = any(m.images and len(m.images) > 0 for m in payload.messages)
    selected_model = "minicpm-v:latest" if has_images else (payload.model or "dolphin-llama3:latest")

    cursor = database.db.system_prompts.find({"is_active": True})
    all_rules = [MANDATORY_RUSSIAN_DIRECTIVE]
    async for doc in cursor:
        p = doc.get("prompt", "").strip()
        if p:
            all_rules.append(p)
    
    sys_content = "\n\n".join(all_rules)

    processed_messages = [{"role": "system", "content": sys_content}]
    for m in payload.messages:
        msg_dict = {"role": m.role, "content": m.content}
        if m.images:
            msg_dict["images"] = m.images
        processed_messages.append(msg_dict)

    # Сохраняем последнее сообщение пользователя
    last_user_msg = payload.messages[-1].model_dump()
    last_user_msg["created_at"] = datetime.datetime.utcnow().isoformat()
    await database.db.chat_threads.update_one(
        {"thread_id": "global_chat"},
        {"$push": {"messages": last_user_msg}, "$set": {"updated_at": datetime.datetime.utcnow().isoformat()}},
        upsert=True
    )

    async def event_generator():
        yield {"data": json.dumps({"type": "meta", "model": selected_model, "has_images": has_images})}

        assistant_full_reply = ""
        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            req_body = {
                "model": selected_model,
                "messages": processed_messages,
                "stream": True
            }
            try:
                async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=req_body) as response:
                    async for chunk in response.aiter_lines():
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

        # По завершению генерации сохраняем ответ ассистента в MongoDB
        if assistant_full_reply:
            assistant_record = {
                "role": "assistant",
                "content": assistant_full_reply,
                "modelUsed": selected_model,
                "created_at": datetime.datetime.utcnow().isoformat()
            }
            await database.db.chat_threads.update_one(
                {"thread_id": "global_chat"},
                {"$push": {"messages": assistant_record}}
            )

    return EventSourceResponse(event_generator())
