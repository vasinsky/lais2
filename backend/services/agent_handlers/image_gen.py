import os
import json
import httpx
import datetime
from typing import AsyncGenerator, Dict, Any
from comfy_service import generate_image_stream, COMFYUI_HTTP
from routers.projects import get_base_dir
from .base import BaseAgentHandler

TRANSLATOR_MODEL = os.getenv("TRANSLATOR_MODEL", "dolphin-llama3:latest")

class ImageGenHandler(BaseAgentHandler):
    def __init__(self, ollama_url: str):
        self.ollama_url = ollama_url

    async def handle(self, task, intent_data: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        yield {"data": json.dumps({"message": {"content": "🎨 Generating image via ComfyUI...\n"}})}

        ckpt = task.comfy_checkpoint or os.getenv("COMFYUI_DEFAULT_CHECKPOINT", "Realistic_Vision_V6.0_NV_B1_fp16.safetensors")
        img_intent = intent_data.get("image_prompt") or task.prompt

        # Переводим в английский промпт для ComfyUI
        eng_desc = img_intent
        async with httpx.AsyncClient(timeout=40.0, trust_env=False) as client:
            try:
                res = await client.post(f"{self.ollama_url}/api/generate", json={
                    "model": TRANSLATOR_MODEL,
                    "prompt": f"Translate to detailed ComfyUI art tags: {img_intent}",
                    "stream": False
                })
                if res.status_code == 200:
                    eng_desc = res.json().get("response", "").strip() or img_intent
            except Exception:
                pass

        custom_subpath = intent_data.get("custom_path")
        ts = int(datetime.datetime.utcnow().timestamp())
        img_rel_path = custom_subpath if (custom_subpath and custom_subpath.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))) else (os.path.join(custom_subpath, f"image_{ts}.png") if custom_subpath else f"image_{ts}.png")
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
                    async with httpx.AsyncClient(timeout=30.0, trust_env=False) as img_client:
                        r = await img_client.get(v_url)
                        if r.status_code == 200:
                            os.makedirs(os.path.dirname(img_path), exist_ok=True)
                            with open(img_path, "wb") as f_img:
                                f_img.write(r.content)
                            yield {"data": json.dumps({
                                "type": "file_saved",
                                "path": img_rel_path,
                                "file_path": img_rel_path,
                                "revision": {"content": f"[Binary image: {img_rel_path}]", "timestamp": "now"}
                            })}
                            yield {"data": json.dumps({
                                "type": "image_result",
                                "url": f"/api/projects/{task.project_name}/preview/{img_rel_path}",
                                "prompt": eng_desc
                            })}
        except Exception as ex:
            yield {"data": json.dumps({"message": {"content": f"ComfyUI error: {str(ex)}\n"}})}
