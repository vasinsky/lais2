import os
import re
import json
import httpx
import datetime
from fastapi import APIRouter, Response, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sse_starlette.sse import EventSourceResponse
import database
from .projects import init_project_structure
from comfy_service import generate_image_stream, interrupt_execution, COMFYUI_HTTP

router = APIRouter()
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/workspace")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")

TRANSLATOR_MODEL = "dolphin-llama3:latest"
VISION_MODEL = "minicpm-v:latest"
DEFAULT_CODER_MODEL = "qwen2.5-coder:7b-instruct-q4_K_M"

class ImageProgressInfo(BaseModel):
    step: int
    total: int
    percent: int
    status: str

class ChatMessage(BaseModel):
    role: str
    content: str
    images: Optional[List[str]] = None
    modelUsed: Optional[str] = None
    generated_image: Optional[str] = None
    image_prompt: Optional[str] = None
    image_progress: Optional[ImageProgressInfo] = None

class ChatPayload(BaseModel):
    model: Optional[str] = None
    comfy_checkpoint: Optional[str] = None
    messages: List[ChatMessage]
    stream: Optional[bool] = True

@router.post("/interrupt")
async def stop_generation():
    """Отменяет текущую генерацию в ComfyUI"""
    success = await interrupt_execution()
    return {"status": "interrupted" if success else "failed"}

@router.get("/image/view")
async def view_comfy_image(filename: str, subfolder: str = "", type: str = "output"):
    async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
        try:
            r = await client.get(
                f"{COMFYUI_HTTP}/view",
                params={"filename": filename, "subfolder": subfolder, "type": type}
            )
            if r.status_code == 200:
                return Response(
                    content=r.content, 
                    media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"}
                )
            raise HTTPException(status_code=r.status_code, detail="Image not found in ComfyUI")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

def parse_project_creation_intent(text: str):
    raw = text.strip()
    lower = raw.lower()

    trigger_words = ["создай", "создать", "сделай", "новый проект", "create", "new"]
    if not any(w in lower for w in trigger_words):
        return None

    ptype = "static"
    if any(k in lower for k in ["докер", "docker"]):
        ptype = "docker"
    elif any(k in lower for k in ["пайтон", "python", "питон"]):
        ptype = "python"
    elif any(k in lower for k in ["статич", "static", "лендинг", "landing", "веб", "web"]):
        ptype = "static"

    match = re.search(r"(?:проект|project)\s+([a-zA-Z0-9_\-]+)", raw, re.IGNORECASE)
    if match:
        proj_name = match.group(1).strip()
        return {"name": proj_name, "project_type": ptype}

    fallback_match = re.search(r"(?:создай|создать|сделай|create|new)\s+(?:статичный|статический|докер|docker|пайтон|python|питон|лендинг|landing)?\s*([a-zA-Z0-9_\-]+)", raw, re.IGNORECASE)
    if fallback_match:
        candidate = fallback_match.group(1).strip()
        stop_words = {"статичный", "статический", "докер", "docker", "пайтон", "python", "питон", "проект", "project", "landing", "лендинг"}
        if candidate.lower() not in stop_words:
            return {"name": candidate, "project_type": ptype}

    return None

def parse_image_generation_intent(text: str) -> Optional[str]:
    raw = text.strip()
    patterns = [
        r"^(?:создай|сделай|сгенерируй|нарисуй)\s+(?:мне\s+)?(?:картинку|изображение|арт|рисунок|фото)\s*(?:про|с|на\s+тему|:)?\s*(.+)$",
        r"^(?:generate|create|draw)\s+(?:an?\s+)?(?:image|picture|photo|art)\s*(?:of|about|:)?\s*(.+)$"
    ]
    for pat in patterns:
        m = re.search(pat, raw, re.IGNORECASE)
        if m:
            desc = m.group(1).strip()
            if desc:
                return desc
    return None

async def enhance_prompt_for_sd(user_desc: str, client: httpx.AsyncClient) -> str:
    system_prompt = (
        "You are an uncensored expert prompt engineer for Stable Diffusion. "
        "Convert the user's description into a high quality, detailed English prompt for image generation. "
        "Include stylistic tags like masterpiece, 8k resolution, highly detailed, dramatic lighting where appropriate. "
        "Output ONLY the prompt in plain English, without quotes, markdown or explanations."
    )
    try:
        res = await client.post(f"{OLLAMA_URL}/api/generate", json={
            "model": TRANSLATOR_MODEL,
            "prompt": f"{system_prompt}\n\nUser request: {user_desc}\n\nPrompt:",
            "stream": False
        }, timeout=35.0)
        if res.status_code == 200:
            enhanced = res.json().get("response", "").strip()
            if enhanced:
                return enhanced
    except Exception:
        pass
    return user_desc

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
    checkpoint = payload.comfy_checkpoint or "Realistic_Vision_V6.0_NV_B1_fp16.safetensors"

    # --- 1. ОБРАБОТКА ГЕНЕРАЦИИ КАРТИНКИ ЧЕРЕЗ COMFYUI ---
    img_desc = parse_image_generation_intent(last_user_msg.content)
    if img_desc:
        now_iso = datetime.datetime.utcnow().isoformat()
        if database.db is not None:
            await database.db.chat_threads.update_one(
                {"thread_id": "global_chat"},
                {"$push": {"messages": {                     "role": "user",                     "content": last_user_msg.content,                     "created_at": now_iso                 }}, "$set": {"updated_at": now_iso}},
                upsert=True
            )

        async def image_event_generator():
            yield {"data": json.dumps({"type": "meta", "model": f"ComfyUI ({checkpoint})", "is_image_task": True})}

            # Перевод и расширение промпта через dolphin-llama3
            async with httpx.AsyncClient(timeout=35.0, trust_env=False) as client:
                sd_prompt = await enhance_prompt_for_sd(img_desc, client)

            yield {"data": json.dumps({
                "type": "image_prompt_ready",
                "prompt": sd_prompt,
                "status": "Prompt generated. Connecting to ComfyUI..."
            })}

            final_img_url = None
            last_progress = {"step": 20, "total": 20, "percent": 100, "status": "Completed"}

            async for ev in generate_image_stream(sd_prompt, checkpoint):
                yield {"data": json.dumps(ev)}
                if ev.get("type") == "image_progress":
                    last_progress = {
                        "step": ev.get("step", 0),
                        "total": ev.get("total", 20),
                        "percent": ev.get("percent", 0),
                        "status": ev.get("status", "")
                    }
                elif ev.get("type") == "image_complete":
                    final_img_url = ev.get("image_url")
                elif ev.get("type") == "image_error":
                    last_progress["status"] = ev.get("error", "Error")

            # Сохранение полного сообщения со всеми артефактами в MongoDB
            if database.db is not None:
                await database.db.chat_threads.update_one(
                    {"thread_id": "global_chat"},
                    {"$push": {"messages": {
                        "role": "assistant",
                        "content": "Image generation completed." if final_img_url else f"Generation failed: {last_progress.get('status')}",
                        "generated_image": final_img_url,
                        "image_prompt": sd_prompt,
                        "image_progress": last_progress,
                        "modelUsed": f"ComfyUI ({checkpoint})",
                        "created_at": datetime.datetime.utcnow().isoformat()
                    }}}
                )

        return EventSourceResponse(
            image_event_generator(),
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    # --- 2. ОБРАБОТКА СОЗДАНИЯ ПРОЕКТА ---
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
            agent_init_reply = f"Project `{proj_name}` ({proj_type}) initialized successfully. Context loaded."
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
        return EventSourceResponse(create_event(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # --- 3. СТАНДАРТНЫЙ ЧАТ OLLAMA ---
    cursor = database.db.system_prompts.find({"is_active": True}) if database.db is not None else []
    active_rules = []
    if database.db is not None:
        async for doc in cursor:
            p = doc.get("prompt", "").strip()
            if p:
                active_rules.append(p)
    global_rules_text = "\n\n".join(active_rules)

    now_iso = datetime.datetime.utcnow().isoformat()
    if database.db is not None:
        await database.db.chat_threads.update_one(
            {"thread_id": "global_chat"},
            {"$push": {"messages": {                 "role": "user",                 "content": last_user_msg.content,                 "images": last_user_msg.images,                 "created_at": now_iso             }}, "$set": {"updated_at": now_iso}},
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

            if assistant_full_reply and database.db is not None:
                await database.db.chat_threads.update_one(
                    {"thread_id": "global_chat"},
                    {"$push": {"messages": {
                        "role": "assistant",
                        "content": assistant_full_reply,
                        "modelUsed": target_model,
                        "created_at": datetime.datetime.utcnow().isoformat()
                    }}}
                )

    return EventSourceResponse(event_generator(), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
