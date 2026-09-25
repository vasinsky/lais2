import os
import time
import httpx
from fastapi import APIRouter

router = APIRouter()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
COMFY_URL = os.getenv("COMFY_URL", "http://host.docker.internal:8188")

@router.get("/status")
async def get_system_status():
    ollama_ok = False
    ollama_models = []
    ollama_error = None
    
    comfy_ok = False
    comfy_checkpoints = []
    comfy_error = None

    async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
        # Проверка Ollama
        try:
            res = await client.get(f"{OLLAMA_URL}/api/tags")
            if res.status_code == 200:
                ollama_ok = True
                ollama_models = [m["name"] for m in res.json().get("models", [])]
            else:
                ollama_error = f"HTTP {res.status_code}"
        except Exception as e:
            ollama_error = str(e)

        # Проверка ComfyUI
        try:
            res = await client.get(f"{COMFY_URL}/object_info/CheckpointLoaderSimple")
            if res.status_code == 200:
                comfy_ok = True
                data = res.json()
                comfy_checkpoints = data["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
            else:
                comfy_error = f"HTTP {res.status_code}"
        except Exception as e:
            comfy_error = str(e)

    return {
        "timestamp": time.time(),
        "ollama": {
            "online": ollama_ok,
            "url": OLLAMA_URL,
            "models": ollama_models,
            "count": len(ollama_models),
            "error": ollama_error
        },
        "comfy": {
            "online": comfy_ok,
            "url": COMFY_URL,
            "checkpoints": comfy_checkpoints,
            "count": len(comfy_checkpoints),
            "error": comfy_error
        }
    }

# Для обратной совместимости
@router.get("/models")
async def get_available_models():
    status = await get_system_status()
    return {
        "ollama": status["ollama"]["models"],
        "comfy": status["comfy"]["checkpoints"]
    }
