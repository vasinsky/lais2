import os
import json
import random
import asyncio
import httpx
import websockets
from typing import AsyncGenerator, Dict, Any, Optional

COMFYUI_HOST = os.getenv("COMFYUI_HOST", "host.docker.internal:8188")
COMFYUI_HTTP = f"http://{COMFYUI_HOST}"
COMFYUI_WS = f"ws://{COMFYUI_HOST}/ws"

def build_workflow(positive_prompt: str, checkpoint_name: str, seed: Optional[int] = None) -> Dict[str, Any]:
    if seed is None:
        seed = random.randint(100000000000000, 999999999999999)

    return {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7,
                "denoise": 1,
                "latent_image": ["5", 0],
                "model": ["4", 0],
                "negative": ["7", 0],
                "positive": ["6", 0],
                "sampler_name": "euler_ancestral",
                "scheduler": "karras",
                "seed": seed,
                "steps": 20
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": checkpoint_name
            }
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "batch_size": 1,
                "height": 512,
                "width": 512
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["4", 1],
                "text": positive_prompt
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["4", 1],
                "text": "ugly, deformed, disfigured, poor details, bad anatomy, blurry, watermark"
            }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "StudioAI",
                "images": ["8", 0]
            }
        }
    }

async def interrupt_execution() -> bool:
    """Отправляет сигнал остановки генерации в ComfyUI"""
    try:
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
            res = await client.post(f"{COMFYUI_HTTP}/interrupt")
            return res.status_code == 200
    except Exception:
        return False

async def generate_image_stream(
    positive_prompt: str, 
    checkpoint_name: str
) -> AsyncGenerator[Dict[str, Any], None]:
    client_id = f"studio_{random.randint(100000, 999999)}"
    workflow = build_workflow(positive_prompt, checkpoint_name)
    ws_url = f"{COMFYUI_WS}?clientId={client_id}"

    output_filename = None
    output_subfolder = ""
    output_type = "output"
    prompt_id = None

    try:
        async with websockets.connect(ws_url, ping_interval=10, ping_timeout=40) as ws:
            async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
                res = await client.post(
                    f"{COMFYUI_HTTP}/prompt",
                    json={"prompt": workflow, "client_id": client_id}
                )
                if res.status_code != 200:
                    yield {"type": "image_error", "error": f"ComfyUI rejected prompt: {res.text}"}
                    return
                prompt_id = res.json().get("prompt_id")

            yield {
                "type": "image_progress", 
                "step": 0, 
                "total": 20, 
                "percent": 0, 
                "status": "Queued in ComfyUI..."
            }

            while True:
                msg = await ws.recv()
                if isinstance(msg, str):
                    data = json.loads(msg)
                    msg_type = data.get("type")
                    msg_data = data.get("data", {})

                    if msg_type == "status":
                        exec_info = msg_data.get("status", {}).get("exec_info", {})
                        rem = exec_info.get("queue_remaining", 0)
                        if rem > 0 and output_filename is None:
                            yield {
                                "type": "image_progress",
                                "step": 0,
                                "total": 20,
                                "percent": 5,
                                "status": f"Queue position: {rem}"
                            }

                    elif msg_type == "progress":
                        val = msg_data.get("value", 0)
                        max_val = msg_data.get("max", 20)
                        pct = int((val / max_val) * 100) if max_val > 0 else 0
                        yield {
                            "type": "image_progress", 
                            "step": val, 
                            "total": max_val, 
                            "percent": pct,
                            "status": f"Sampling: step {val} of {max_val}"
                        }

                    elif msg_type == "executed" and msg_data.get("prompt_id") == prompt_id:
                        images = msg_data.get("output", {}).get("images", [])
                        if images:
                            output_filename = images[0].get("filename")
                            output_subfolder = images[0].get("subfolder", "")
                            output_type = images[0].get("type", "output")
                            break

                    elif msg_type == "execution_interrupted" and msg_data.get("prompt_id") == prompt_id:
                        yield {"type": "image_error", "error": "Generation cancelled by user."}
                        return

                    elif msg_type == "execution_error" and msg_data.get("prompt_id") == prompt_id:
                        err = msg_data.get("exception_message", "ComfyUI execution error")
                        yield {"type": "image_error", "error": err}
                        return
    except Exception:
        pass

    # Фолбэк проверка истории очереди если сокет разорвался
    if not output_filename and prompt_id:
        async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
            for _ in range(12):
                await asyncio.sleep(1.0)
                try:
                    h_res = await client.get(f"{COMFYUI_HTTP}/history/{prompt_id}")
                    if h_res.status_code == 200:
                        h_data = h_res.json().get(prompt_id, {})
                        outputs = h_data.get("outputs", {})
                        for _, out in outputs.items():
                            imgs = out.get("images", [])
                            if imgs:
                                output_filename = imgs[0].get("filename")
                                output_subfolder = imgs[0].get("subfolder", "")
                                output_type = imgs[0].get("type", "output")
                                break
                    if output_filename:
                        break
                except Exception:
                    pass

    if output_filename:
        yield {
            "type": "image_progress", 
            "step": 20, 
            "total": 20, 
            "percent": 100, 
            "status": "Fetching generated image and sending to chat..."
        }
        await asyncio.sleep(0.3)
        yield {
            "type": "image_complete",
            "filename": output_filename,
            "subfolder": output_subfolder,
            "prompt": positive_prompt,
            "image_url": f"http://localhost:8000/api/chat/image/view?filename={output_filename}&subfolder={output_subfolder}&type={output_type}"
        }
    else:
        yield {"type": "image_error", "error": "Generation ended but output image was not found."}
