import subprocess
import socket
import json
import os

def get_compose_file_path(name: str) -> str | None:
    root = os.environ.get("PROJECTS_ROOT_DIR", "/app/projects")
    proj_dir = os.path.join(root, name)
    for fname in ["docker-compose.yml", "docker-compose.yaml"]:
        p = os.path.join(proj_dir, fname)
        if os.path.isfile(p):
            return p
    return None

import logging
logger = logging.getLogger(__name__)

def get_host_project_path(project_name: str):
    try:
        cid = socket.gethostname()
        res = subprocess.run(
            ["docker", "inspect", cid, "--format", "{{json .Mounts}}"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if res.returncode == 0 and res.stdout.strip():
            mounts = json.loads(res.stdout.strip())
            # Сначала ищем точное совпадение с папкой проектов
            for m in mounts:
                if m.get("Destination") == "/app/projects":
                    return os.path.join(m.get("Source"), project_name)
            # Запасной вариант: если /app смонтирован из корня репозитория
            for m in mounts:
                if m.get("Destination") == "/app":
                    src = m.get("Source")
                    # если /app указывает на папку backend, поднимаемся на уровень выше к корню
                    if os.path.basename(src) == "backend":
                        src = os.path.dirname(src)
                    return os.path.join(src, "projects", project_name)
    except Exception as exc:
        logger.warning(f"Host path resolution error: {exc}")
    return None

import shutil
from fastapi.responses import FileResponse
import os
import sys
import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Request, Response
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

def record_file_revision(project_name: str, file_path: str, content: str, source: str = "agent") -> dict:
    clean_p = file_path.lstrip(r"./\ ")
    hist_key = f"{project_name}:{clean_p}"
    if hist_key not in _file_history_store:
        _file_history_store[hist_key] = []
    
    rev = {
        "id": str(len(_file_history_store[hist_key]) + 1),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,
        "content": content
    }
    _file_history_store[hist_key].insert(0, rev)
    return rev


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


@router.get("/{name}/preview")
@router.get("/{name}/preview/")
@router.get("/{name}/preview/{file_path:path}")
async def preview_project_file(name: str, file_path: str = ""):
    from fastapi.responses import RedirectResponse

    cur_ws = get_base_dir()
    proj_dir = os.path.realpath(os.path.join(cur_ws, name))
    if not os.path.isdir(proj_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    # 1. Docker Compose: ищем опубликованный порт хоста
    compose_names = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]
    for c_name in compose_names:
        c_path = os.path.join(proj_dir, c_name)
        if os.path.isfile(c_path):
            try:
                with open(c_path, "r", encoding="utf-8") as cf:
                    for line in cf:
                        cleaned = line.strip().strip("-").strip().replace('"', '').replace("'", "")
                        # Ищем строки формата 8080:80 или 127.0.0.1:8080:80
                        if ":" in cleaned:
                            parts = cleaned.split(":")
                            if len(parts) >= 2:
                                host_cand = parts[-2].split("/")[-1].strip()
                                container_cand = parts[-1].split("/")[-0].strip()
                                if host_cand.isdigit() and container_cand.isdigit():
                                    return RedirectResponse(url=f"http://localhost:{host_cand}/")
            except Exception:
                pass

    # 2. Обычный статический проект
    target_path = os.path.realpath(os.path.join(proj_dir, file_path))
    if not target_path.startswith(proj_dir):
        raise HTTPException(status_code=403, detail="Access denied")

    if os.path.isdir(target_path):
        subfolders_to_check = ["", "app", "public", "dist", "www", "build"]
        found_index = None

        for sub in subfolders_to_check:
            check_dir = os.path.realpath(os.path.join(proj_dir, sub)) if sub else target_path
            if os.path.isdir(check_dir):
                candidates = [
                    f for f in sorted(os.listdir(check_dir))
                    if os.path.isfile(os.path.join(check_dir, f)) and f.lower().startswith("index.")
                ]
                if candidates:
                    found_index = os.path.join(check_dir, candidates[0])
                    break

        if not found_index:
            raise HTTPException(status_code=404, detail="No index.* file found in directory or known subdirectories")
        target_path = found_index

    if not os.path.isfile(target_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(target_path)


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
    clean_p = path.lstrip(r"./\ ")
    hist_key = f"{name}:{clean_p}"
    mem_revs = _file_history_store.get(hist_key, [])
    if mem_revs:
        return mem_revs

    # Фоллбек на MongoDB, если в памяти нет
    try:
        import database
        cursor = database.db.file_history.find({"project_name": name, "path": {"$in": [clean_p, f"./{clean_p}", path]}}).sort("created_at", -1)
        db_revs = []
        async for doc in cursor:
            db_revs.append({
                "id": str(doc.get("_id")),
                "timestamp": doc.get("timestamp") or doc.get("created_at", ""),
                "source": doc.get("source", "agent"),
                "content": doc.get("content", "")
            })
        if db_revs:
            _file_history_store[hist_key] = db_revs
            return db_revs
    except Exception:
        pass

    return []

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




# --- Python Process Manager ---
_python_procs: dict[str, dict] = {}

def _find_free_port(start_port=8050, max_port=8099):
    for p in range(start_port, max_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return 8050

@router.get("/{name}/python/status")
async def get_python_status(name: str):
    cur_ws = get_base_dir()
    proj_dir = os.path.realpath(os.path.join(cur_ws, name))
    if not os.path.isdir(proj_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    entry_file = None
    for f in ["main.py", "app.py", "server.py", "run.py"]:
        p = os.path.join(proj_dir, f)
        if os.path.isfile(p):
            entry_file = f
            break

    proc_info = _python_procs.get(name)
    running = False
    port = None

    if proc_info:
        proc = proc_info.get("process")
        if proc and proc.poll() is None:
            running = True
            port = proc_info.get("port")
        else:
            _python_procs.pop(name, None)

    return {
        "has_python": entry_file is not None,
        "entry_file": entry_file,
        "running": running,
        "port": port
    }

@router.post("/{name}/python/start")
async def start_python_project(name: str):
    cur_ws = get_base_dir()
    proj_dir = os.path.realpath(os.path.join(cur_ws, name))
    if not os.path.isdir(proj_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    proc_info = _python_procs.get(name)
    if proc_info and proc_info.get("process") and proc_info["process"].poll() is None:
        return {"status": "already_running", "port": proc_info.get("port")}

    entry_file = None
    for f in ["main.py", "app.py", "server.py", "run.py"]:
        p = os.path.join(proj_dir, f)
        if os.path.isfile(p):
            entry_file = f
            break

    if not entry_file:
        raise HTTPException(status_code=400, detail="No Python entrypoint found (main.py, app.py, server.py)")

    # Проверяем, указан ли жесткий порт внутри файла скрипта
    entry_path = os.path.join(proj_dir, entry_file)
    with open(entry_path, "r", encoding="utf-8", errors="ignore") as f:
        src = f.read()

    port = None
    import re as _re
    m = _re.search(r"port\s*=\s*(\d{2,5})", src)
    if m:
        port = int(m.group(1))
    else:
        port = _find_free_port()

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["PYTHONUNBUFFERED"] = "1"

    log_path = os.path.join(proj_dir, ".python_run.log")
    log_file = open(log_path, "a", encoding="utf-8")

    # Изолированное виртуальное окружение для проекта
    venv_dir = os.path.join(proj_dir, ".venv")
    venv_python = os.path.join(venv_dir, "bin", "python")
    venv_pip = os.path.join(venv_dir, "bin", "pip")
    setup_logs = []

    if not os.path.isfile(venv_python):
        msg = "[studio] Creating isolated virtual environment (.venv)..."
        log_file.write(msg + "\n")
        log_file.flush()
        setup_logs.append(msg)

        res = subprocess.run([sys.executable, "-m", "venv", venv_dir], cwd=proj_dir, capture_output=True, text=True)
        if res.stdout:
            log_file.write(res.stdout + "\n")
            setup_logs.append(res.stdout.strip())
        if res.returncode != 0:
            err_msg = res.stderr or "Unknown venv creation error"
            log_file.write(err_msg + "\n")
            log_file.close()
            raise HTTPException(status_code=500, detail=f"Failed to initialize .venv: {err_msg}")
        setup_logs.append("[studio] Virtual environment successfully created.")

    # Проверка и установка requirements.txt при наличии изменений
    req_path = os.path.join(proj_dir, "requirements.txt")
    if os.path.isfile(req_path):
        import hashlib
        with open(req_path, "rb") as rf:
            cur_hash = hashlib.md5(rf.read()).hexdigest()
        
        hash_file = os.path.join(venv_dir, ".reqs_hash")
        prev_hash = None
        if os.path.isfile(hash_file):
            try:
                with open(hash_file, "r", encoding="utf-8") as hf:
                    prev_hash = hf.read().strip()
            except Exception:
                pass

        if cur_hash != prev_hash:
            msg = "[studio] Installing / updating dependencies from requirements.txt..."
            log_file.write(msg + "\n")
            log_file.flush()
            setup_logs.append(msg)

            pip_env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
            pip_res = subprocess.run(
                [venv_pip, "install", "--isolated", "--no-cache-dir", "-r", "requirements.txt"],
                cwd=proj_dir,
                env=pip_env,
                capture_output=True,
                text=True
            )

            if pip_res.returncode == 0:
                try:
                    with open(hash_file, "w", encoding="utf-8") as hf:
                        hf.write(cur_hash)
                except Exception:
                    pass
                setup_logs.append("[studio] Dependencies installed successfully.")
            else:
                warn_msg = pip_res.stderr or "pip install warning"
                log_file.write(warn_msg + "\n")
                setup_logs.append(f"[studio] Pip error/warning: {warn_msg.strip()}")
        else:
            setup_logs.append("[studio] Dependencies are up to date (cached).")

    # Запускаем скрипт изолированным интерпретатором
    start_msg = f"[studio] Starting {entry_file} on port {port}..."
    log_file.write(start_msg + "\n")
    log_file.flush()
    setup_logs.append(start_msg)

    proc = subprocess.Popen(
        [venv_python, entry_file],
        cwd=proj_dir,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT
    )

    _python_procs[name] = {
        "process": proc,
        "port": port,
        "log_file": log_file
    }

    return {
        "status": "started",
        "port": port,
        "pid": proc.pid,
        "setup_log": "\n".join(setup_logs)
    }

@router.post("/{name}/python/stop")
async def stop_python_project(name: str):
    proc_info = _python_procs.get(name)
    if not proc_info or not proc_info.get("process"):
        return {"status": "not_running"}

    proc = proc_info["process"]
    try:
        proc.terminate()
        proc.wait(timeout=3)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

    log_file = proc_info.get("log_file")
    if log_file and not log_file.closed:
        try:
            log_file.close()
        except Exception:
            pass

    _python_procs.pop(name, None)
    return {"status": "stopped"}


@router.api_route("/{name}/python/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def python_project_proxy(name: str, path: str, request: Request):
    proc_info = _python_procs.get(name)
    if not proc_info or not proc_info.get("process") or proc_info["process"].poll() is not None:
        raise HTTPException(status_code=503, detail="Python project server is not running. Please start it first.")

    port = proc_info.get("port")
    target_url = f"http://127.0.0.1:{port}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    async with httpx.AsyncClient() as client:
        try:
            req_content = await request.body()
            headers = dict(request.headers)
            headers.pop("host", None)
            
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=req_content,
                timeout=30.0
            )
            
            from fastapi.responses import Response
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=dict(resp.headers)
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Proxy error: {str(e)}")


@router.get("/{name}/compose/status")
async def get_compose_status(name: str):
    cur_ws = get_base_dir()
    proj_dir = os.path.realpath(os.path.join(cur_ws, name))
    if not os.path.isdir(proj_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    compose_file = None
    for f in ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]:
        p = os.path.join(proj_dir, f)
        if os.path.isfile(p):
            compose_file = p
            break

    if not compose_file:
        return {"has_compose": False, "running": False, "port": None}

    try:
        res = subprocess.run(
            ["docker", "compose", "-f", compose_file, "ps", "--format", "json"],
            cwd=proj_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5
        )
        running = False
        port = None
        if res.returncode == 0 and res.stdout.strip():
            running = True
            try:
                for line in res.stdout.strip().splitlines():
                    if not line.strip():
                        continue
                    cdata = json.loads(line)
                    publishers = cdata.get("Publishers") or []
                    for pub in publishers:
                        pub_port = pub.get("PublishedPort")
                        if pub_port:
                            port = pub_port
                            break
                    if port:
                        break
            except Exception:
                pass

        if not port:
            try:
                with open(compose_file, "r", encoding="utf-8") as cf:
                    ccontent = cf.read()
                import re as _re
                m = _re.search(r"(\d{2,5}):\d+", ccontent)
                if m:
                    port = int(m.group(1))
            except Exception:
                pass

        return {"has_compose": True, "running": running, "port": port}
    except Exception:
        return {"has_compose": True, "running": False, "port": None}

@router.post("/{name}/compose/up")
async def compose_up(name: str):
    proj_dir = os.path.join(os.environ.get("PROJECTS_ROOT_DIR", "/app/projects"), name)
    compose_file = get_compose_file_path(name)
    if not compose_file:
        raise HTTPException(status_code=404, detail="docker-compose.yml not found")
    try:
        host_dir = get_host_project_path(name)
        cmd = ["docker", "compose", "-f", compose_file]
        if host_dir:
            cmd.extend(["--project-directory", host_dir])
        cmd.extend(["up", "-d"])
        res = subprocess.run(
            cmd,
            cwd=proj_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60
        )
        if res.returncode != 0:
            raise HTTPException(status_code=500, detail=res.stderr or "Failed to start containers")
        return {"status": "started", "output": res.stdout}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/compose/down")
async def compose_down(name: str):
    proj_dir = os.path.join(os.environ.get("PROJECTS_ROOT_DIR", "/app/projects"), name)
    compose_file = get_compose_file_path(name)
    if not compose_file:
        raise HTTPException(status_code=404, detail="docker-compose.yml not found")
    try:
        host_dir = get_host_project_path(name)
        cmd = ["docker", "compose", "-f", compose_file]
        if host_dir:
            cmd.extend(["--project-directory", host_dir])
        cmd.extend(["down"])
        res = subprocess.run(
            cmd,
            cwd=proj_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30
        )
        if res.returncode != 0:
            raise HTTPException(status_code=500, detail=res.stderr or "Failed to stop containers")
        return {"status": "stopped", "output": res.stdout}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))