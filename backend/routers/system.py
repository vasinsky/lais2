import os
import httpx
from fastapi import Query, APIRouter

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

@router.get("/model-info")
async def get_model_info(model: str = Query(...)):
    ollama_base = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.post(f"{ollama_base}/api/show", json={"name": model})
            if res.status_code == 200:
                data = res.json()
                model_info = data.get("model_info", {})
                
                # Ищем параметры контекста модели
                ctx = None
                for k, v in model_info.items():
                    if "context_length" in k:
                        ctx = v
                        break
                
                # Если нет в model_info, проверяем параметры modelfile
                if not ctx:
                    params_str = data.get("parameters", "")
                    m = re.search(r"num_ctx\s+(\d+)", params_str)
                    if m:
                        ctx = int(m.group(1))
                        
                return {
                    "model": model,
                    "context_length": ctx or 4096,
                    "details": data.get("details", {})
                }
    except Exception as e:
        print(f"[MODEL-INFO ERROR] {e}")
        
    return {"model": model, "context_length": 4096}
