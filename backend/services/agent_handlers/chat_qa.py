import json
import httpx
import datetime
import database
from typing import AsyncGenerator, Dict, Any
from .base import BaseAgentHandler

class ChatQAHandler(BaseAgentHandler):
    def __init__(self, ollama_url: str, default_model: str):
        self.ollama_url = ollama_url
        self.default_model = default_model

    async def handle(self, task, intent_data: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        target_model = task.model or self.default_model

        # Получаем правила проекта
        cursor = database.db.system_prompts.find({"is_active": True}) if database.db is not None else []
        active_rules = []
        if database.db is not None:
            async for doc in cursor:
                p = doc.get("prompt", "").strip()
                if p:
                    active_rules.append(p)
        global_rules_text = "\n\n".join(active_rules)

        # История сообщений агента
        session = await database.db.agent_sessions.find_one({"project_name": task.project_name}) if database.db is not None else None
        session_messages = session.get("messages", []) if session else []
        recent_messages = session_messages[-8:] if len(session_messages) > 8 else session_messages

        file_tree = intent_data.get("file_tree", [])
        system_instruction = (
            f'You are a helpful Senior AI Engineer assisting with the project "{task.project_name}".\n'
            f"Current Project files:\n{json.dumps(file_tree[:150])}\n\n"
            f"Global Rules:\n{global_rules_text}\n\n"
            "INSTRUCTIONS:\n"
            "1. Answer user questions clearly, helpfully, and professionally.\n"
            "2. Respond strictly in RUSSIAN.\n"
            "3. If explaining code or architecture, format it nicely with standard markdown blocks."
        )

        dialog_history = [{"role": "system", "content": system_instruction}]
        for m in recent_messages:
            dialog_history.append({"role": m["role"], "content": m["content"]})
        dialog_history.append({"role": "user", "content": task.prompt})

        payload = {
            "model": target_model,
            "messages": dialog_history,
            "stream": True,
            "options": {"num_ctx": 16384, "temperature": 0.4}
        }

        raw_full_output = ""
        async with httpx.AsyncClient(timeout=180.0, trust_env=False) as client:
            async with client.stream("POST", f"{self.ollama_url}/api/chat", json=payload) as resp:
                async for chunk in resp.aiter_lines():
                    if not chunk:
                        continue
                    try:
                        d = json.loads(chunk)
                        token = d.get("message", {}).get("content", "")
                        if token:
                            raw_full_output += token
                            yield {"data": json.dumps({"message": {"content": token}})}
                    except Exception:
                        pass

        if database.db is not None:
            await database.db.agent_sessions.update_one(
                {"project_name": task.project_name},
                {"$push": {"messages": {
                    "role": "assistant",
                    "content": raw_full_output,
                    "modelUsed": target_model,
                    "created_at": datetime.datetime.utcnow().isoformat()
                }}}
            )
