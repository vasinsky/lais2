import shutil
from fastapi.responses import FileResponse
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
        proj_type = args[1] if len(args) > 1 else kwargs.get("proj_type", kwargs.get("template", "static"))
    else:
        proj_name = kwargs.get("project_name", kwargs.get("proj_name", "project"))
        proj_dir = kwargs.get("proj_path", kwargs.get("proj_dir", os.path.join(get_base_dir(), proj_name)))
        proj_type = kwargs.get("proj_type", kwargs.get("template", "static"))

    os.makedirs(proj_dir, exist_ok=True)
    files = kwargs.get("files")
    if isinstance(files, dict):
        for rel_path, c in files.items():
            full_p = os.path.join(proj_dir, rel_path)
            os.makedirs(os.path.dirname(full_p), exist_ok=True)
            with open(full_p, "w", encoding="utf-8") as f:
                f.write(c)
        return proj_dir

    if proj_type == "static":
        css_dir = os.path.join(proj_dir, "css")
        js_dir = os.path.join(proj_dir, "js")
        images_dir = os.path.join(proj_dir, "images")
        os.makedirs(css_dir, exist_ok=True)
        os.makedirs(js_dir, exist_ok=True)
        os.makedirs(images_dir, exist_ok=True)

        index_file = os.path.join(proj_dir, "index.html")
        if not os.path.exists(index_file):
            with open(index_file, "w", encoding="utf-8") as f:
                f.write("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>""" + proj_name + """</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <header>
        <h1>Welcome to """ + proj_name + """</h1>
    </header>
    <main>
        <p>Project initialized successfully.</p>
    </main>
    <script src="js/script.js"></script>
</body>
</html>
""")

        css_file = os.path.join(css_dir, "style.css")
        if not os.path.exists(css_file):
            with open(css_file, "w", encoding="utf-8") as f:
                f.write("""* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    background-color: #0f172a;
    color: #f8fafc;
    padding: 2rem;
}

header {
    margin-bottom: 2rem;
}

h1 {
    color: #38bdf8;
}
""")

        js_file = os.path.join(js_dir, "script.js")
        if not os.path.exists(js_file):
            with open(js_file, "w", encoding="utf-8") as f:
                f.write("""document.addEventListener("DOMContentLoaded", () => {
    console.log("Project initialized");
});
""")
        return proj_dir

    elif proj_type == "docker":
        app_dir = os.path.join(proj_dir, "app")
        os.makedirs(app_dir, exist_ok=True)

        app_index = os.path.join(app_dir, "index.html")
        if not os.path.exists(app_index):
            with open(app_index, "w", encoding="utf-8") as f:
                f.write("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>""" + proj_name + """ - Nginx App</title>
</head>
<body>
    <h1>Docker Nginx Service</h1>
    <p>Served from """ + proj_name + """/app via containerized Nginx.</p>
</body>
</html>
""")

        compose_file = os.path.join(proj_dir, "docker-compose.yml")
        if not os.path.exists(compose_file):
            with open(compose_file, "w", encoding="utf-8") as f:
                f.write("""services:
  web:
    image: nginx:alpine
    container_name: """ + proj_name + """_web
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./app:/usr/share/nginx/html:ro
""")
        return proj_dir

    elif proj_type == "python":
        main_file = os.path.join(proj_dir, "main.py")
        if not os.path.exists(main_file):
            with open(main_file, "w", encoding="utf-8") as f:
                f.write("""def main():
    print("Welcome to """ + proj_name + """")


if __name__ == "__main__":
    main()
""")

        req_file = os.path.join(proj_dir, "requirements.txt")
        if not os.path.exists(req_file):
            with open(req_file, "w", encoding="utf-8") as f:
                f.write("""requests>=2.31.0
pydantic>=2.0.0
python-dotenv>=1.0.0
""")
        return proj_dir

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


@router.get("/{name}/raw-file")
async def get_raw_file(name: str, path: str = Query(...)):
    cur_ws = get_base_dir()
    file_path = os.path.join(cur_ws, name, path)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

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


class CreateProjectPayload(BaseModel):
    name: str

@router.post("")
@router.post("/")
async def create_new_project(payload: CreateProjectPayload):
    proj_name = payload.name.strip().strip("/")
    if not proj_name or ".." in proj_name or "/" in proj_name or "\\" in proj_name:
        raise HTTPException(status_code=400, detail="Invalid project name")
    
    base_dir = get_base_dir()
    proj_dir = os.path.realpath(os.path.join(base_dir, proj_name))
    if not proj_dir.startswith(os.path.realpath(base_dir)):
        raise HTTPException(status_code=400, detail="Invalid path traversal")
    
    if os.path.exists(proj_dir):
        raise HTTPException(status_code=409, detail=f"Project '{proj_name}' already exists")
    
    os.makedirs(proj_dir, exist_ok=True)
    return {"status": "success", "project": proj_name}

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

class CreateDirectoryPayload(BaseModel):
    path: str

class MoveItemPayload(BaseModel):
    source: str
    destination: str

@router.post("/{name}/directory")
async def create_project_directory(name: str, payload: CreateDirectoryPayload):
    base_dir = get_base_dir()
    proj_root = os.path.realpath(os.path.join(base_dir, name))
    target_dir = os.path.realpath(os.path.join(proj_root, payload.path.lstrip("/")))
    
    if not target_dir.startswith(proj_root):
        raise HTTPException(status_code=400, detail="Invalid path traversal")
    
    os.makedirs(target_dir, exist_ok=True)
    return {"status": "success", "path": payload.path}

@router.delete("/{name}/file")
async def delete_project_file(name: str, path: str = Query(...)):
    base_dir = get_base_dir()
    proj_root = os.path.realpath(os.path.join(base_dir, name))
    target_path = os.path.realpath(os.path.join(proj_root, path.lstrip("/")))
    
    if not target_path.startswith(proj_root):
        raise HTTPException(status_code=400, detail="Invalid path traversal")
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="File or folder not found")
        
    try:
        if os.path.isdir(target_path):
            shutil.rmtree(target_path)
        else:
            os.remove(target_path)
        return {"status": "success", "deleted": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{name}/move")
async def move_project_file(name: str, payload: MoveItemPayload):
    base_dir = get_base_dir()
    proj_root = os.path.realpath(os.path.join(base_dir, name))
    src_path = os.path.realpath(os.path.join(proj_root, payload.source.lstrip("/")))
    
    raw_dest = payload.destination.strip().lstrip("/")
    dest_path = os.path.realpath(os.path.join(proj_root, raw_dest))
    
    if not src_path.startswith(proj_root) or not dest_path.startswith(proj_root):
        raise HTTPException(status_code=400, detail="Invalid path traversal")
    if not os.path.exists(src_path):
        raise HTTPException(status_code=404, detail="Source not found")
        
    if os.path.isdir(dest_path):
        final_dest = os.path.join(dest_path, os.path.basename(src_path))
    else:
        final_dest = dest_path

    os.makedirs(os.path.dirname(final_dest), exist_ok=True)
    shutil.move(src_path, final_dest)
    
    new_rel_path = os.path.relpath(final_dest, proj_root)
    return {"status": "success", "new_path": new_rel_path}

@router.delete("/{name}")
async def delete_project(name: str):
    base_dir = get_base_dir()
    proj_root = os.path.realpath(os.path.join(base_dir, name))
    
    if not proj_root.startswith(base_dir) or proj_root == base_dir:
        raise HTTPException(status_code=400, detail="Invalid project name")
    if not os.path.exists(proj_root):
        raise HTTPException(status_code=404, detail="Project not found")
        
    try:
        shutil.rmtree(proj_root)
        # Очищаем историю файлов удаленного проекта
        keys_to_del = [k for k in _file_history_store if k.startswith(f"{name}:")]
        for k in keys_to_del:
            _file_history_store.pop(k, None)
        return {"status": "success", "deleted": name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
