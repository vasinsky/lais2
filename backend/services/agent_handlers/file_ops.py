import os
import re
import json
import httpx
import datetime
import database
from typing import AsyncGenerator, Dict, Any
from services.mcp_client import mcp_client
from .base import BaseAgentHandler

WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/projects")

class FileOpsHandler(BaseAgentHandler):
    def __init__(self, ollama_url: str, default_model: str):
        self.ollama_url = ollama_url
        self.default_model = default_model

    async def handle(self, task, intent_data: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        target_model = task.model or self.default_model
        proj_path = os.path.abspath(os.path.join(WORKSPACE_DIR, task.project_name))
        target_file = intent_data.get("target_file")
        file_tree = intent_data.get("file_tree", [])

        if target_file:
            yield {"data": json.dumps({"type": "stream_target", "file_path": target_file})}

        cursor = database.db.system_prompts.find({"is_active": True}) if database.db is not None else []
        active_rules = []
        if database.db is not None:
            async for doc in cursor:
                p = doc.get("prompt", "").strip()
                if p:
                    active_rules.append(p)
        global_rules_text = "\n\n".join(active_rules)

        session = await database.db.agent_sessions.find_one({"project_name": task.project_name}) if database.db is not None else None
        session_messages = session.get("messages", []) if session else []
        recent_messages = session_messages[-8:] if len(session_messages) > 8 else session_messages

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
        dialog_history.append({"role": "user", "content": task.prompt})

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

        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            is_first_chunk = True
            code_started = False
            prefix_buf = ""

            async with client.stream("POST", f"{self.ollama_url}/api/chat", json=payload) as resp:
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

        # Сохранение файлов через MCP и фиксация в БД
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

            if "Error executing tool read_file" in body:
                body = "\n".join([ln for ln in body.splitlines() if not ln.strip().startswith("Error executing tool read_file")]).strip()

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

        if database.db is not None:
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
