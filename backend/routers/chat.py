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
    thread = await database.db.chat_threads.find_one({"thread_id": "global_chat"})
    return thread.get("messages", []) if thread else []

@router.delete("/history")
async def clear_global_history():
    await database.db.chat_threads.delete_one({"thread_id": "global_chat"})
    return {"status": "cleared"}

@router.post("/completions")
async def chat_stream(payload: ChatPayload):
    target_model = payload.model or DEFAULT_CODER_MODEL
    has_images = any(m.images and len(m.images) > 0 for m in payload.messages)
    last_user_msg = payload.messages[-1]

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
        {"$push": {"messages": {
            "role": "user",
            "content": last_user_msg.content,
            "images": last_user_msg.images,
            "created_at": now_iso
        }}, "$set": {"updated_at": now_iso}},
        upsert=True
    )

    async def event_generator():
        yield {"data": json.dumps({"type": "meta", "model": target_model})}

        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            # Пре-перевод под капотом
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
