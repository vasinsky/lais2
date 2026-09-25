import os
import sys
import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx

router = APIRouter(tags=["projects"])

def get_base_dir() -> str:
    env_dir = os.getenv("PROJECTS_ROOT_DIR")
    if env_dir and os.path.exists(env_dir):
        return env_dir
    chat_mod = sys.modules.get("routers.chat") or sys.modules.get("chat")
    if chat_mod and hasattr(chat_mod, "WORKSPACE_DIR") and chat_mod.WORKSPACE_DIR:
        return chat_mod.WORKSPACE_DIR
    return env_dir if env_dir else "/app/projects"

_file_history_store: Dict[str, List[Dict[str, Any]]] = {}

def init_project_structure(*args, **kwargs) -> str:
    if len(args) == 3 and isinstance(args[0], str) and isinstance(args[1], str) and isinstance(args[2], str):
        proj_dir, proj_name, proj_type = args[0], args[1], args[2]
    elif len(args) >= 1:
        first = args[0]
        if os.path.isabs(first) or "/" in first:
            proj_dir = first
            proj_name = os.path.basename(first)
        else:
            proj_name = first
            proj_dir = os.path.join(get_base_dir(), proj_name)
        proj_type = args[1] if len(args) > 1 else kwargs.get("template", "generic")
    else:
        proj_name = kwargs.get("project_name", "project")
        proj_dir = kwargs.get("proj_path", os.path.join(get_base_dir(), proj_name))
        proj_type = kwargs.get("template", "generic")

    os.makedirs(proj_dir, exist_ok=True)
    files = kwargs.get("files")
    if isinstance(files, dict):
        for rel_path, content in files.items():
            full_p = os.path.join(proj_dir, rel_path)
            os.makedirs(os.path.dirname(full_p), exist_ok=True)
            with open(full_p, "w", encoding="utf-8") as f:
                f.write(content)
        return proj_dir

    readme_path = os.path.join(proj_dir, "README.md")
    if not os.path.exists(readme_path):
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(f"# {proj_name}\n\nProject created in Local AI Studio.\n")

    if proj_type == "docker":
        dc_path = os.path.join(proj_dir, "docker-compose.yml")
        if not os.path.exists(dc_path):
            with open(dc_path, "w", encoding="utf-8") as f:
                f.write("version: '3.8'\nservices:\n  app:\n    image: alpine\n    command: sleep infinity\n")
    elif proj_type == "python":
        main_py = os.path.join(proj_dir, "main.py")
        if not os.path.exists(main_py):
            with open(main_py, "w", encoding="utf-8") as f:
                f.write('print("Hello from Local AI Studio!")\n')
        req_txt = os.path.join(proj_dir, "requirements.txt")
        if not os.path.exists(req_txt):
            with open(req_txt, "w", encoding="utf-8") as f:
                f.write("# requirements\n")

    return proj_dir

@router.get("", response_model=List[str])
@router.get("/", response_model=List[str])
async def list_projects():
    cur_ws = get_base_dir()
    if not os.path.exists(cur_ws):
        return []
    return sorted([
        d for d in os.listdir(cur_ws)
        if os.path.isdir(os.path.join(cur_ws, d)) and not d.startswith(".")
    ])

def build_tree(current_path: str, rel_path: str = "") -> List[Dict[str, Any]]:
    nodes = []
    try:
        entries = sorted(os.listdir(current_path))
    except Exception:
        return nodes

    for entry in entries:
        if entry.startswith(".") or entry == "__pycache__":
            continue
        full_entry_path = os.path.join(current_path, entry)
        node_rel_path = os.path.join(rel_path, entry) if rel_path else entry

        if os.path.isdir(full_entry_path):
            nodes.append({
                "name": entry,
                "path": node_rel_path,
                "type": "directory",
                "file_type": "other",
                "children": build_tree(full_entry_path, node_rel_path)
            })
        else:
            ext = os.path.splitext(entry)[1].lower()
            if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]:
                ftype = "image"
            elif ext in [".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".md", ".txt", ".yml", ".yaml"]:
                ftype = "code"
            else:
                ftype = "other"

            nodes.append({
                "name": entry,
                "path": node_rel_path,
                "type": "file",
                "file_type": ftype
            })
    return nodes

@router.get("/{name}/tree")
async def get_project_tree(name: str, subpath: Optional[str] = None):
    cur_ws = get_base_dir()
    proj_path = os.path.join(cur_ws, name)
    if not os.path.isdir(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")

    target_dir = os.path.join(proj_path, subpath) if subpath else proj_path
    if not os.path.isdir(target_dir):
        raise HTTPException(status_code=404, detail="Subpath not found")

    return build_tree(target_dir, rel_path=subpath if subpath else "")

@router.get("/{name}/file")
async def get_file_content(name: str, path: str = Query(...)):
    cur_ws = get_base_dir()
    file_path = os.path.join(cur_ws, name, path)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SaveFileRequest(BaseModel):
    path: str
    content: str
    source: str = "manual_save"

@router.post("/{name}/file")
async def save_file_content(name: str, payload: SaveFileRequest):
    cur_ws = get_base_dir()
    proj_path = os.path.join(cur_ws, name)
    os.makedirs(proj_path, exist_ok=True)
    file_path = os.path.join(proj_path, payload.path)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(payload.content)

    hist_key = f"{name}:{payload.path}"
    if hist_key not in _file_history_store:
        _file_history_store[hist_key] = []

    rev = {
        "id": str(len(_file_history_store[hist_key]) + 1),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": payload.source,
        "content": payload.content
    }
    _file_history_store[hist_key].insert(0, rev)

    return {"status": "ok", "path": payload.path, "revision": rev}

class SaveImageRequest(BaseModel):
    image_url: str
    target_dir: str = ""
    filename: str

@router.post("/{name}/save-image")
async def save_image_to_project(name: str, payload: SaveImageRequest):
    cur_ws = get_base_dir()
    proj_path = os.path.join(cur_ws, name)
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")

    dest_dir = os.path.join(proj_path, payload.target_dir) if payload.target_dir else proj_path
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, payload.filename)

    url = payload.image_url
    if "filename=" in url:
        comfy_base = "http://host.docker.internal:8188"
        query_part = url.split("?", 1)[1] if "?" in url else ""
        view_url = f"{comfy_base}/view?{query_part}"
    else:
        view_url = url

    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(view_url)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch image bytes")
        with open(dest_path, "wb") as f:
            f.write(res.content)

    rel_dest = os.path.join(payload.target_dir, payload.filename) if payload.target_dir else payload.filename
    return {
        "status": "success",
        "file_path": rel_dest
    }

@router.get("/{name}/history")
async def get_file_history(name: str, path: str = Query(...)):
    hist_key = f"{name}:{path}"
    return _file_history_store.get(hist_key, [])

@router.delete("/{name}/history")
async def clear_file_history(name: str, path: str = Query(...)):
    hist_key = f"{name}:{path}"
    if hist_key in _file_history_store:
        _file_history_store[hist_key] = []
    return {"status": "ok"}
