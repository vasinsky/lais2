from services.mcp_client import mcp_client
import bson
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
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/projects")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")

TRANSLATOR_MODEL = os.getenv("TRANSLATOR_MODEL", "dolphin-llama3:latest")
VISION_MODEL = os.getenv("VISION_MODEL", "minicpm-v:latest")
DEFAULT_CODER_MODEL = os.getenv("DEFAULT_CODER_MODEL", "qwen2.5-coder:7b-instruct-q4_K_M")

from comfy_service import generate_image_stream, COMFYUI_HTTP
from routers.projects import get_base_dir

def extract_custom_image_path(prompt: str) -> Optional[str]:
    patterns = [
        r"(?:в\s+папку|в\s+папке|в\s+директорию|path:|folder:)\s+([a-zA-Z0-9_\-/\.]+)",
        r"(?:сохрани(?:ть)?\s+в|положи\s+в)\s+([a-zA-Z0-9_\-/\.]+)",
    ]
    for p in patterns:
        m = re.search(p, prompt, re.IGNORECASE)
        if m:
            clean_path = m.group(1).strip(" \t\r\n'\"/\\")
            if clean_path and ".." not in clean_path:
                return clean_path
    return None

def detect_agent_image_prompt(text: str) -> Optional[str]:
    raw = text.strip()
    patterns = [
        r"(?:наполни|добавь|создай|сгенерируй|нарисуй).*?(?:картинк|фото|изображен|арт)[а-яA-Za-z0-9_\s]*?(?:про|с|:)?\s*(.*)",
        r"(?:generate|create|draw|add|make).*?(?:image|picture|photo|asset|render)[a-zA-Z0-9_\s]*?(?:of|for|about|:)?\s*(.*)",
        r"^(?:нарисуй|отрисуй|сделай арт|изобрази|draw|sketch|paint|render)\s+(.*)",
        r"(?:сгенерируй|создай|generate|create).*?\.(?:png|jpg|jpeg|webp)"
    ]
    for p in patterns:
        m = re.search(p, raw, re.IGNORECASE)
        if m:
            groups = m.groups()
            desc = groups[0].strip() if groups and groups[0] else raw
            desc = re.sub(r"(?:и\s+|and\s+)?(?:сохрани|положи|save|put|store).*$", "", desc, flags=re.IGNORECASE).strip()
            return desc if len(desc) > 3 else raw
    return None

class AgentTask(BaseModel):
    project_name: str
    prompt: str
    model: Optional[str] = None
    images: Optional[List[str]] = None
    active_file_path: Optional[str] = None
    active_file_content: Optional[str] = None
    comfy_checkpoint: Optional[str] = None

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
    proj_path = os.path.abspath(os.path.join(WORKSPACE_DIR, task.project_name))
    os.makedirs(proj_path, exist_ok=True)

    lower_prompt = task.prompt.lower().strip()

    try:
        mcp_items = await mcp_client.list_files(task.project_name)
        file_tree = [item["path"] for item in mcp_items if not item.get("is_dir", False)]
    except Exception:
        file_tree = get_clean_project_files(proj_path)

    prompt_files = re.findall(r"[a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+", task.prompt)
    clean_prompt_files = []
    for cf in prompt_files:
        c = cf.strip("`'\".,;:()[]{}<> \t\n")
        if c and not c.endswith((".com", ".org", ".net", ".ru", ".io")):
            clean_prompt_files.append(c)
    clean_prompt_files = list(dict.fromkeys(clean_prompt_files))

    is_project_scaffold = any(k in lower_prompt for k in ["проект", "project", "архитектур", "структур", "каркас"])
    target_file = None

    if is_project_scaffold or len(clean_prompt_files) > 1:
        target_file = None
    elif len(clean_prompt_files) == 1:
        target_file = clean_prompt_files[0]
    elif task.active_file_path and any(k in lower_prompt for k in ["этот файл", "текущий", "измени", "дополни", "исправь", "в него"]):
        target_file = task.active_file_path

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
        {"$push": {"messages": {"role": "user", "content": task.prompt, "images": task.images, "created_at": now_iso}}, "$set": {"updated_at": now_iso}},
        upsert=True
    )

    async def event_generator():
        yield {"data": json.dumps({"type": "meta", "model": target_model})}
        if target_file:
            yield {"data": json.dumps({"type": "stream_target", "file_path": target_file})}

        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            user_agent_prompt = task.prompt
            if task.images and len(task.images) > 0:
                try:
                    vision_summary = await analyze_vision_to_english(task.prompt, task.images, client)
                    user_agent_prompt = task.prompt + "\n\n[Visual Context]: " + str(vision_summary)
                except Exception:
                    pass

            if target_file:
                existing_file_content = ""
                full_target_p = os.path.join(proj_path, target_file)
                if os.path.exists(full_target_p):
                    try:
                        with open(full_target_p, "r", encoding="utf-8") as ef:
                            existing_file_content = ef.read()
                    except Exception:
                        pass

                context_extra = f"\nCurrent content of {target_file}:\n{existing_file_content}\n" if existing_file_content else ""

                system_instruction = (
                    f'You are editing the file "{target_file}" in project "{task.project_name}".\n'
                    f"{context_extra}"
                    f"Global Directives:\n{global_rules_text}\n\n"
                    "CRITICAL INSTRUCTIONS:\n"
                    "1. Return ONLY the complete raw source code for this file.\n"
                    "2. NO explanations, NO greetings, NO markdown wrappers (do NOT use ```).\n"
                    "3. Start immediately from line 1 of code."
                )
            else:
                system_instruction = (
                    f'You are a Senior Project Architect for project: "{task.project_name}".\n'
                    f"Global Directives:\n{global_rules_text}\n\n"
                    f"Current Project Files: {json.dumps(file_tree[:150])}\n\n"
                    "CRITICAL MULTI-FILE SPECIFICATION:\n"
                    "1. Produce ALL necessary project files and directories requested.\n"
                    "2. For EVERY file, output strictly in this format:\n"
                    "[FILE: path/to/filename.ext]\n"
                    "complete code\n"
                    "[/FILE]\n"
                    "3. DO NOT output conversational text, greetings, or descriptions.\n"
                    "4. Output only valid [FILE: ...] [/FILE] blocks."
                )

            dialog_history = [{"role": "system", "content": system_instruction}]
            for m in recent_messages:
                dialog_history.append({"role": m["role"], "content": m["content"]})
            dialog_history.append({"role": "user", "content": user_agent_prompt})

            img_intent = detect_agent_image_prompt(task.prompt)
            generated_image_names = []
            if img_intent:
                yield {"data": json.dumps({"message": {"content": "🎨 Generating image via ComfyUI...\n"}})}
                ckpt = task.comfy_checkpoint or os.getenv("COMFYUI_DEFAULT_CHECKPOINT", "Realistic_Vision_V6.0_NV_B1_fp16.safetensors")
                eng_desc = await translate_text_to_english(img_intent, client)
                custom_subpath = extract_custom_image_path(task.prompt)
                ts = int(datetime.datetime.utcnow().timestamp())
                img_rel_path = custom_subpath if (custom_subpath and custom_subpath.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))) else (os.path.join(custom_subpath, f"image_{ts}.png") if custom_subpath else f"image_{ts}.png")
                img_filename = img_rel_path
                img_path = os.path.join(get_base_dir(), task.project_name, img_rel_path)

                try:
                    async for event in generate_image_stream(eng_desc, ckpt):
                        ev_type = event.get("type") if isinstance(event, dict) else ""
                        if ev_type == "image_progress":
                            yield {"data": json.dumps({"type": "image_progress", "step": event.get("step", 0), "total": event.get("total", 20), "percent": event.get("percent", 0)})}
                        elif ev_type == "image_complete":
                            raw_name = event.get("filename")
                            subfolder = event.get("subfolder", "")
                            v_url = f"{COMFYUI_HTTP}/view?filename={raw_name}" + (f"&subfolder={subfolder}" if subfolder else "")
                            async with httpx.AsyncClient(timeout=30.0) as img_client:
                                r = await img_client.get(v_url)
                                if r.status_code == 200:
                                    os.makedirs(os.path.dirname(img_path), exist_ok=True)
                                    with open(img_path, "wb") as f_img:
                                        f_img.write(r.content)
                                    generated_image_names.append(img_filename)
                                    yield {"data": json.dumps({"type": "file_saved", "path": img_filename, "file_path": img_filename, "revision": {"content": f"[Binary image: {img_filename}]", "timestamp": "now"}})}
                except Exception as ex:
                    yield {"data": json.dumps({"message": {"content": f"ComfyUI error: {str(ex)}\n"}})}

            payload = {
                "model": target_model,
                "messages": dialog_history,
                "stream": True,
                "options": {"num_ctx": 16384, "temperature": 0.2 if target_file else 0.3}
            }

            current_file = target_file
            open_tag_re = re.compile(r"\[FILE:\s*([^\]]+)\]|```[a-zA-Z0-9_+-]*\s*(?:<!--|/\*|//|#)?\s*([a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+)", re.IGNORECASE)
            close_tag_re = re.compile(r"\[/FILE\]|```\s*$", re.MULTILINE)
            raw_full_output = ""
            buf = ""

            try:
                if current_file:
                    yield {"data": json.dumps({"type": "stream_target", "file_path": current_file})}

                async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
                    is_first_chunk = True
                    code_started = False
                    prefix_buf = ""

                    async for chunk in resp.aiter_lines():
                        if not chunk:
                            continue
                        try:
                            d = json.loads(chunk)
                            token = d.get("message", {}).get("content", "")
                            if not token:
                                continue
                            raw_full_output += token

                            if target_file:
                                if not code_started:
                                    prefix_buf += token
                                    if len(prefix_buf) < 15 and ("`" in prefix_buf or "\n" in prefix_buf):
                                        continue
                                    clean_prefix = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", prefix_buf.lstrip())
                                    prefix_buf = ""
                                    code_started = True
                                    if clean_prefix:
                                        yield {"data": json.dumps({"type": "stream_code", "path": target_file, "chunk": clean_prefix, "is_start": is_first_chunk})}
                                        is_first_chunk = False
                                    continue

                                if "```" in token:
                                    parts = re.split(r"```", token, maxsplit=1)
                                    if parts[0]:
                                        yield {"data": json.dumps({"type": "stream_code", "path": target_file, "chunk": parts[0], "is_start": is_first_chunk})}
                                    break

                                yield {"data": json.dumps({"type": "stream_code", "path": target_file, "chunk": token, "is_start": is_first_chunk})}
                                is_first_chunk = False
                            else:
                                buf += token
                                if not current_file:
                                    m = open_tag_re.search(buf)
                                    if m:
                                        current_file = (m.group(1) or m.group(2)).strip().strip("/\\ ")
                                        buf = ""
                                        is_first_chunk = True
                                        yield {"data": json.dumps({"type": "stream_target", "file_path": current_file})}
                                else:
                                    if close_tag_re.search(buf):
                                        current_file = None
                                        buf = ""
                                    else:
                                        yield {"data": json.dumps({
                                            "type": "stream_code",
                                            "path": current_file,
                                            "chunk": token,
                                            "is_start": is_first_chunk
                                        })}
                                        is_first_chunk = False
                        except Exception:
                            pass

                if prefix_buf and target_file and not code_started:
                    clean_p = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", prefix_buf.lstrip())
                    if clean_p:
                        yield {"data": json.dumps({"type": "stream_code", "path": target_file, "chunk": clean_p, "is_start": is_first_chunk})}
            except Exception as e:
                yield {"data": json.dumps({"error": str(e)})}

            files_to_save = []
            if target_file and raw_full_output.strip():
                clean_body = raw_full_output.strip()
                if clean_body.startswith("```"):
                    lines = clean_body.splitlines()
                    if len(lines) > 2 and lines[-1].strip() == "```":
                        clean_body = chr(10).join(lines[1:-1])
                files_to_save.append((target_file, clean_body))
            else:
                matches = re.findall(r"\[FILE:\s*([^\]]+)\]\s*(.*?)\s*\[/FILE\]", raw_full_output, re.DOTALL)
                if not matches:
                    matches = re.findall(r"(?:###|#)\s*([a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+).*?```[a-zA-Z0-9_\-]*\s*\n(.*?)\n```", raw_full_output, re.DOTALL)
                files_to_save = matches

            report_lines = []
            created_dirs = set()

            for rpath_raw, code_body in files_to_save:
                rpath = rpath_raw.strip().strip("/\\ ")
                if not rpath or "." not in rpath:
                    continue

                full_disk_path = os.path.abspath(os.path.join(WORKSPACE_DIR, task.project_name, rpath))
                existed_before = os.path.exists(full_disk_path)

                dir_name = os.path.dirname(rpath)
                if dir_name and dir_name not in created_dirs:
                    full_dir_path = os.path.dirname(full_disk_path)
                    if not os.path.exists(full_dir_path):
                        os.makedirs(full_dir_path, exist_ok=True)
                        created_dirs.add(dir_name)
                        report_lines.append(f"Directory created: {dir_name}/")

                body = code_body.strip()
                if body.startswith("```"):
                    lines = body.splitlines()
                    if len(lines) > 2 and lines[-1].strip() == "```":
                        body = chr(10).join(lines[1:-1])

                # Удаляем мусорные строки ошибок MCP-чтения, если они прилипли к коду
                if "Error executing tool read_file" in body:
                    clean_lines = [ln for ln in body.splitlines() if not ln.strip().startswith("Error executing tool read_file")]
                    body = "\n".join(clean_lines).strip()

                try:
                    await mcp_client.write_file(task.project_name, rpath, body)
                except Exception:
                    os.makedirs(os.path.dirname(full_disk_path), exist_ok=True)
                    with open(full_disk_path, "w", encoding="utf-8") as f:
                        f.write(body)

                now_dt = datetime.datetime.utcnow()
                t_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")

                try:
                    from routers.projects import record_file_revision
                    in_mem_rev = record_file_revision(task.project_name, rpath, body, source="agent")
                except Exception:
                    in_mem_rev = None

                ins = await database.db.file_history.insert_one({
                    "project_name": task.project_name,
                    "path": rpath.lstrip("./\\ "),
                    "content": body,
                    "source": "agent",
                    "created_at": now_dt.isoformat(),
                    "timestamp": t_str
                })

                rev_payload = in_mem_rev if in_mem_rev else {
                    "id": str(ins.inserted_id),
                    "timestamp": t_str,
                    "created_at": now_dt.isoformat(),
                    "content": body,
                    "source": "agent"
                }

                yield {"data": json.dumps({
                    "type": "file_saved",
                    "path": rpath.lstrip("./\\ "),
                    "revision": rev_payload
                })}

                if existed_before:
                    report_lines.append(f"File modified: {rpath}")
                else:
                    report_lines.append(f"File created: {rpath}")

            final_report = "\n".join(report_lines) if report_lines else "No file operations performed."
            yield {"data": json.dumps({"message": {"content": f"\n```text\n{final_report}\n```\n"}})}

            await database.db.agent_sessions.update_one(
                {"project_name": task.project_name},
                {"$push": {"messages": {
                    "role": "assistant",
                    "content": final_report,
                    "modelUsed": target_model,
                    "saved_files": [r.strip().strip("/\\ ") for r, _ in files_to_save],
                    "created_at": datetime.datetime.utcnow().isoformat()
                }}}
            )

    return EventSourceResponse(event_generator())
