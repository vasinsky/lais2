import os
import httpx
from fastapi import APIRouter

router = APIRouter()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://host.docker.internal:8188")

@router.get("/status")
@router.get("/")
async def get_system_status():
    ollama_data = {"status": "offline", "models": []}
    comfy_data = {"status": "offline", "checkpoints": []}

    async with httpx.AsyncClient(timeout=4.0, trust_env=False) as client:
        # Ollama check
        try:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code == 200:
                ollama_data["status"] = "online"
                ollama_data["models"] = r.json().get("models", [])
        except Exception:
            pass

        # ComfyUI check
        try:
            r = await client.get(f"{COMFYUI_URL}/object_info/CheckpointLoaderSimple")
            if r.status_code == 200:
                comfy_data["status"] = "online"
                ckpt_info = r.json().get("CheckpointLoaderSimple", {}).get("input", {}).get("required", {}).get("ckpt_name", [])
                if ckpt_info and isinstance(ckpt_info[0], list):
                    comfy_data["checkpoints"] = ckpt_info[0]
        except Exception:
            pass

    return {
        "ollama": ollama_data,
        "comfyui": comfy_data
    }
