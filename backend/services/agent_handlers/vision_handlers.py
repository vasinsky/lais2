import os
import json
import httpx
import datetime
import database
from typing import AsyncGenerator, Dict, Any
from .base import BaseAgentHandler
from .image_gen import ImageGenHandler

VISION_MODEL = os.getenv("VISION_MODEL", "minicpm-v:latest")

class VisionQAHandler(BaseAgentHandler):
    def __init__(self, ollama_url: str):
        self.ollama_url = ollama_url

    async def handle(self, task, intent_data: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        clean_images = []
        for img in (task.images or []):
            clean_images.append(img.split(",", 1)[1] if "," in img else img)

        prompt = (
            f"Ты эксперт визуального анализа. Пользователь задал вопрос: \"{task.prompt}\".\n"
            "Проведи технический анализ изображения: разметка, компоненты, цветовая схема, структура или ошибки.\n"
            "Отвечай строго на РУССКОМ ЯЗЫКЕ.\nОтвет:"
        )

        async with httpx.AsyncClient(timeout=90.0, trust_env=False) as client:
            full_reply = ""
            async with client.stream("POST", f"{self.ollama_url}/api/generate", json={
                "model": VISION_MODEL,
                "prompt": prompt,
                "images": clean_images,
                "stream": True
            }) as res:
                async for line in res.aiter_lines():
                    if not line:
                        continue
                try:
                    chunk = json.loads(line)
                    token = chunk.get("response", "")
                    if token:
                        full_reply += token
                        yield {"data": json.dumps({"message": {"content": token}})}
                except Exception:
                    pass

        if database.db is not None:
            await database.db.agent_sessions.update_one(
                {"project_name": task.project_name},
                {"$push": {"messages": {
                    "role": "assistant",
                    "content": full_reply,
                    "modelUsed": VISION_MODEL,
                    "created_at": datetime.datetime.utcnow().isoformat()
                }}}
            )

class ImageToImageHandler(BaseAgentHandler):
    def __init__(self, ollama_url: str):
        self.ollama_url = ollama_url
        self.image_gen = ImageGenHandler(ollama_url)

    async def handle(self, task, intent_data: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        clean_images = []
        for img in (task.images or []):
            clean_images.append(img.split(",", 1)[1] if "," in img else img)

        yield {"data": json.dumps({"message": {"content": "🔍 Analyzing image reference for reproduction...\n"}})}

        extracted_tags = task.prompt
        async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
            try:
                res = await client.post(f"{self.ollama_url}/api/generate", json={
                    "model": VISION_MODEL,
                    "prompt": "Analyze this reference image. Provide ONLY concise Stable Diffusion prompt tags in English describing subject, composition, theme, and lighting. No explanations.",
                    "images": clean_images,
                    "stream": False
                })
                if res.status_code == 200:
                    extracted_tags = res.json().get("response", "").strip() or task.prompt
            except Exception:
                pass

        intent_data["image_prompt"] = extracted_tags
        async for event in self.image_gen.handle(task, intent_data):
            yield event
