import os
import re
import json
import httpx
import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sse_starlette.sse import EventSourceResponse
import database

router = APIRouter()
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/workspace")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")

TRANSLATOR_MODEL = "dolphin-llama3:latest"
VISION_MODEL = "minicpm-v:latest"
DEFAULT_CODER_MODEL = "qwen2.5-coder:7b-instruct-q4_K_M"

class AgentTask(BaseModel):
    project_name: str
    prompt: str
    model: Optional[str] = None
    images: Optional[List[str]] = None
    active_file_path: Optional[str] = None
    active_file_content: Optional[str] = None

class ApplyCodePayload(BaseModel):
    project_name: str
    file_path: str
    content: str

def get_clean_project_files(proj_path: str) -> List[str]:
    ignored = {'.git', 'node_modules', '__pycache__', '.vite', 'dist', '.DS_Store', 'mongo-data'}
    file_list = []
    for root, dirs, files in os.walk(proj_path):
        dirs[:] = [d for d in dirs if d not in ignored and not d.startswith('.')]
        for f in files:
            if f.startswith('.') or f in ignored:
                continue
            rel = os.path.relpath(os.path.join(root, f), proj_path).replace("\\", "/")
            file_list.append(rel)
    return file_list

async def translate_text_to_english(text: str, client: httpx.AsyncClient) -> str:
    if not text.strip():
        return ""
    prompt = (
        "Translate the following software programming request to clear, technical English. "
        "Preserve filenames, paths, and identifiers. Output ONLY the English translation:\n\n" + text
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
        f"Analyze this image for software engineering tasks. User query: {text}\n"
        "Provide a detailed technical description and query in English. Output ONLY the English translation:"
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

@router.get("/{project_name}/history")
async def get_agent_history(project_name: str):
    session = await database.db.agent_sessions.find_one({"project_name": project_name})
    return session.get("messages", []) if session else []

@router.delete("/{project_name}/history")
async def clear_agent_history(project_name: str):
    await database.db.agent_sessions.delete_one({"project_name": project_name})
    return {"status": "cleared", "project_name": project_name}

@router.post("/execute")
async def execute_agent_task(task: AgentTask):
    target_model = task.model or DEFAULT_CODER_MODEL
    proj_path = os.path.abspath(os.path.join(WORKSPACE_DIR, task.project_name))
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")

    lower_prompt = task.prompt.lower().strip()

    if any(k in lower_prompt for k in ["создай проект", "создать проект", "новый проект", "create project", "new project"]):
        ignore_msg = f"Вы уже находитесь в контексте проекта `{task.project_name}`. Для создания нового проекта используйте вкладку Global Chat или кнопку «+» в левой панели."
        async def ignore_stream():
            yield {"data": json.dumps({"type": "meta", "model": target_model})}
            yield {"data": json.dumps({"message": {"content": ignore_msg}})}
        return EventSourceResponse(ignore_stream())

    file_tree = get_clean_project_files(proj_path)

    write_patterns = [
        r"(?:заполни|напиши|вставь|создай код для|перепиши)\s+([a-zA-Z0-9_\-\.\/]+)",
        r"(?:fill|write|update)\s+([a-zA-Z0-9_\-\.\/]+)"
    ]
    target_match = None
    for pattern in write_patterns:
        m = re.search(pattern, lower_prompt)
        if m:
            target_match = m.group(1).strip()
            break

    target_file = None
    ambiguous_files = []

    if target_match:
        matched_candidates = []
        for f in file_tree:
            base_f = os.path.basename(f).lower()
            if f.lower() == target_match.lower() or base_f == target_match.lower():
                matched_candidates.append(f)

        if len(matched_candidates) == 1:
            target_file = matched_candidates[0]
        elif len(matched_candidates) > 1:
            ambiguous_files = matched_candidates
    elif task.active_file_path and any(k in lower_prompt for k in ["этот файл", "текущий файл", "в файл", "в него"]):
        target_file = task.active_file_path

    if ambiguous_files:
        msg_reply = (
            f"В проекте найдено несколько файлов с похожим именем:\n" +
            "\n".join([f"- `{f}`" for f in ambiguous_files]) +
            "\n\nПожалуйста, уточните полный путь к файлу."
        )
        async def ambiguous_stream():
            yield {"data": json.dumps({"type": "meta", "model": target_model})}
            yield {"data": json.dumps({"message": {"content": msg_reply}})}
        return EventSourceResponse(ambiguous_stream())

    cursor = database.db.system_prompts.find({"is_active": True})
    active_rules = []
    async for doc in cursor:
        p = doc.get("prompt", "").strip()
        if p:
            active_rules.append(p)
    global_rules_text = "\n\n".join(active_rules)

    session = await database.db.agent_sessions.find_one({"project_name": task.project_name})
    session_messages = session.get("messages", []) if session else []
    recent_messages = session_messages[-8:] if len(session_messages) > 8 else session_messages

    now_iso = datetime.datetime.utcnow().isoformat()
    await database.db.agent_sessions.update_one(
        {"project_name": task.project_name},
        {"$push": {"messages": {             "role": "user",             "content": task.prompt,             "images": task.images,             "created_at": now_iso         }}, "$set": {"updated_at": now_iso}},
        upsert=True
    )

    async def event_generator():
        yield {"data": json.dumps({"type": "meta", "model": target_model})}
        if target_file:
            yield {"data": json.dumps({"type": "stream_target", "file_path": target_file})}

        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            if task.images and len(task.images) > 0:
                translated_prompt = await analyze_vision_to_english(task.prompt, task.images, client)
            else:
                translated_prompt = await translate_text_to_english(task.prompt, client)

            if target_file:
                system_instruction = (
                    f"You are directly modifying the file '{target_file}' in project '{task.project_name}'.\n"
                    f"Global Directives:\n{global_rules_text}\n\n"
                    "OUTPUT SPECIFICATION:\n"
                    "1. Return ONLY the raw source code for this file.\n"
                    "2. Do NOT output conversational chatter or markdown backticks.\n"
                    "3. Complete and valid code from start to finish."
                )
            else:
                system_instruction = (
                    f"You are an autonomous Senior Developer in project: '{task.project_name}'.\n"
                    f"Global Directives:\n{global_rules_text}\n\n"
                    f"Project Files:\n{json.dumps(file_tree[:150], indent=2)}\n"
                    f"Active file: {task.active_file_path or 'None'}\n"
                    "Always converse and explain in fluent RUSSIAN, while writing high-quality code."
                )

            dialog_history = [{"role": "system", "content": system_instruction}]
            for m in recent_messages:
                dialog_history.append({"role": m["role"], "content": m["content"]})
            dialog_history.append({"role": "user", "content": translated_prompt})

            accumulated_code = ""
            payload = {
                "model": target_model,
                "messages": dialog_history,
                "stream": True,
                "options": {"num_ctx": 16384, "temperature": 0.2 if target_file else 0.4}
            }
            try:
                async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
                    async for chunk in resp.aiter_lines():
                        if chunk:
                            try:
                                d = json.loads(chunk)
                                token = d.get("message", {}).get("content", "")
                                accumulated_code += token
                            except Exception:
                                pass
                            yield {"data": chunk}
            except Exception as e:
                yield {"data": json.dumps({"error": str(e)})}

            if target_file and accumulated_code.strip():
                clean_code = accumulated_code.strip()
                if clean_code.startswith("```"):
                    lines = clean_code.splitlines()
                    if len(lines) > 2 and lines[-1].strip() == "```":
                        clean_code = "\n".join(lines[1:-1])

                target_disk_path = os.path.abspath(os.path.join(WORKSPACE_DIR, task.project_name, target_file))
                os.makedirs(os.path.dirname(target_disk_path), exist_ok=True)
                with open(target_disk_path, "w", encoding="utf-8") as f:
                    f.write(clean_code)

                now_dt = datetime.datetime.utcnow()
                timestamp_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
                insert_res = await database.db.file_history.insert_one({
                    "project_name": task.project_name,
                    "file_path": target_file,
                    "content": clean_code,
                    "created_at": now_dt.isoformat(),
                    "timestamp": timestamp_str
                })

                rev_data = {
                    "id": str(insert_res.inserted_id),
                    "timestamp": timestamp_str,
                    "created_at": now_dt.isoformat(),
                    "content": clean_code
                }

                yield {"data": json.dumps({"type": "file_saved", "file_path": target_file, "revision": rev_data})}

                agent_summary = f"Код сгенерирован и сохранен в `{target_file}`."
                await database.db.agent_sessions.update_one(
                    {"project_name": task.project_name},
                    {"$push": {"messages": {
                        "role": "assistant",
                        "content": agent_summary,
                        "modelUsed": target_model,
                        "created_at": datetime.datetime.utcnow().isoformat()
                    }}}
                )
            elif not target_file and accumulated_code:
                await database.db.agent_sessions.update_one(
                    {"project_name": task.project_name},
                    {"$push": {"messages": {
                        "role": "assistant",
                        "content": accumulated_code,
                        "modelUsed": target_model,
                        "created_at": datetime.datetime.utcnow().isoformat()
                    }}}
                )

    return EventSourceResponse(event_generator())
