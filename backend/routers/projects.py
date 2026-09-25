import httpx

import os
import shutil
import datetime
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
import database

router = APIRouter()
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/workspace")

class ProjectCreate(BaseModel):
    name: str
    project_type: Optional[str] = "static"

class FileWrite(BaseModel):
    path: str
    content: str

class CreateItem(BaseModel):
    path: str
    is_dir: bool

def normalize_rel_path(p: str) -> str:
    return p.strip().replace("\\", "/").lstrip("/")

def get_file_header_comment(filename: str) -> str:
    tag = "created from local ai studio"
    ext = os.path.splitext(filename)[1].lower()
    
    if ext in ['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.php']:
        return f"// {tag}\n\n"
    elif ext in ['.py', '.sh', '.bash', '.yaml', '.yml', '.toml', '.dockerfile', '.env'] or filename.lower() in ['dockerfile', 'makefile']:
        return f"# {tag}\n\n"
    elif ext in ['.html', '.htm', '.xml', '.svg']:
        return f"<!-- {tag} -->\n\n"
    elif ext in ['.css', '.scss']:
        return f"/* {tag} */\n\n"
    return f"# {tag}\n\n"

def detect_project_type(proj_path: str, stored_type: Optional[str] = None) -> str:
    if stored_type in ["static", "docker", "python"]:
        return stored_type
    files = os.listdir(proj_path) if os.path.exists(proj_path) else []
    if any(f in files for f in ["docker-compose.yml", "docker-compose.yaml", "Dockerfile"]):
        return "docker"
    if any(f in files for f in ["main.py", "requirements.txt", "Pipfile", "pyproject.toml"]):
        return "python"
    return "static"

def init_project_structure(proj_path: str, proj_name: str, ptype: str):
    os.makedirs(proj_path, exist_ok=True)
    
    if ptype == "static":
        html_lines = [
            "<!-- created from local ai studio -->",
            "<!DOCTYPE html>",
            '<html lang="ru">',
            "<head>",
            '  <meta charset="UTF-8">',
            '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            f"  <title>{proj_name}</title>",
            '  <link rel="stylesheet" href="style.css">',
            "</head>",
            "<body>",
            '  <main class="container">',
            f"    <h1>Добро пожаловать в {proj_name}</h1>",
            "    <p>Статичный веб-проект успешно инициализирован.</p>",
            "  </main>",
            '  <script src="script.js"></script>',
            "</body>",
            "</html>\n"
        ]
        css_lines = [
            "/* created from local ai studio */",
            "* {",
            "  margin: 0;",
            "  padding: 0;",
            "  box-sizing: border-box;",
            "}",
            "",
            "body {",
            "  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
            "  background-color: #0f172a;",
            "  color: #f8fafc;",
            "  display: flex;",
            "  align-items: center;",
            "  justify-content: center;",
            "  min-height: 100vh;",
            "}",
            "",
            ".container {",
            "  text-align: center;",
            "  padding: 2.5rem;",
            "  background: #1e293b;",
            "  border-radius: 12px;",
            "  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);",
            "}",
            "",
            "h1 {",
            "  font-size: 2rem;",
            "  margin-bottom: 0.75rem;",
            "  color: #38bdf8;",
            "}",
            "",
            "p {",
            "  color: #94a3b8;",
            "}\n"
        ]
        js_lines = [
            "// created from local ai studio",
            "document.addEventListener('DOMContentLoaded', () => {",
            "  console.log('Project initialized successfully.');",
            "});\n"
        ]
        with open(os.path.join(proj_path, "index.html"), "w", encoding="utf-8") as f:
            f.write("\n".join(html_lines))
        with open(os.path.join(proj_path, "style.css"), "w", encoding="utf-8") as f:
            f.write("\n".join(css_lines))
        with open(os.path.join(proj_path, "script.js"), "w", encoding="utf-8") as f:
            f.write("\n".join(js_lines))

    elif ptype == "docker":
        compose_lines = [
            "# created from local ai studio",
            "version: '3.8'",
            "",
            "services:",
            "  web:",
            "    image: nginx:alpine",
            f"    container_name: {proj_name}_nginx",
            "    ports:",
            '      - "8080:80"',
            "    volumes:",
            "      - ./html:/usr/share/nginx/html:ro",
            "      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro",
            "    restart: unless-stopped\n"
        ]
        nginx_lines = [
            "# created from local ai studio",
            "server {",
            "    listen 80;",
            "    server_name localhost;",
            "",
            "    location / {",
            "        root /usr/share/nginx/html;",
            "        index index.html;",
            "        try_files $uri $uri/ /index.html;",
            "    }",
            "}\n"
        ]
        docker_html_lines = [
            "<!-- created from local ai studio -->",
            "<!DOCTYPE html>",
            '<html lang="ru">',
            "<head>",
            '  <meta charset="UTF-8">',
            f"  <title>{proj_name} - Nginx Docker</title>",
            "  <style>",
            "    body {",
            "      background: #0b1120;",
            "      color: #38bdf8;",
            "      font-family: sans-serif;",
            "      display: flex;",
            "      height: 100vh;",
            "      align-items: center;",
            "      justify-content: center;",
            "      margin: 0;",
            "    }",
            "    .box {",
            "      text-align: center;",
            "      padding: 40px;",
            "      border: 1px solid #1e293b;",
            "      border-radius: 12px;",
            "      background: #0f172a;",
            "    }",
            "  </style>",
            "</head>",
            "<body>",
            '  <div class="box">',
            "    <h1>Docker + Nginx</h1>",
            f"    <p style=\"color: #94a3b8;\">Проект {proj_name} готов к запуску через docker-compose.</p>",
            "  </div>",
            "</body>",
            "</html>\n"
        ]
        os.makedirs(os.path.join(proj_path, "html"), exist_ok=True)
        with open(os.path.join(proj_path, "docker-compose.yml"), "w", encoding="utf-8") as f:
            f.write("\n".join(compose_lines))
        with open(os.path.join(proj_path, "nginx.conf"), "w", encoding="utf-8") as f:
            f.write("\n".join(nginx_lines))
        with open(os.path.join(proj_path, "html", "index.html"), "w", encoding="utf-8") as f:
            f.write("\n".join(docker_html_lines))

    elif ptype == "python":
        main_lines = [
            "# created from local ai studio",
            "import sys",
            "",
            "def main():",
            f"    print(\"Project '{proj_name}' started successfully.\")",
            "",
            "if __name__ == '__main__':",
            "    main()\n"
        ]
        req_lines = [
            "# created from local ai studio",
            "requests>=2.31.0",
            "python-dotenv>=1.0.0\n"
        ]
        ignore_lines = [
            "# created from local ai studio",
            "__pycache__/",
            "*.py[cod]",
            "*$py.class",
            ".venv/",
            "venv/",
            "ENV/",
            ".env\n"
        ]
        readme_lines = [
            "# created from local ai studio",
            f"# {proj_name}",
            "",
            "Python project created in Local AI Studio.",
            "",
            "## Quick Start",
            "```bash",
            "python3 -m venv .venv",
            "source .venv/bin/activate",
            "pip install -r requirements.txt",
            "python main.py",
            "```\n"
        ]
        with open(os.path.join(proj_path, "main.py"), "w", encoding="utf-8") as f:
            f.write("\n".join(main_lines))
        with open(os.path.join(proj_path, "requirements.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(req_lines))
        with open(os.path.join(proj_path, ".gitignore"), "w", encoding="utf-8") as f:
            f.write("\n".join(ignore_lines))
        with open(os.path.join(proj_path, "README.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(readme_lines))

@router.get("/")
async def list_projects():
    if not os.path.exists(WORKSPACE_DIR):
        os.makedirs(WORKSPACE_DIR, exist_ok=True)
    all_dirs = sorted([d for d in os.listdir(WORKSPACE_DIR) if os.path.isdir(os.path.join(WORKSPACE_DIR, d)) and not d.startswith('.')])
    
    settings_docs = await database.db.project_settings.find().to_list(length=1000)
    settings_map = {doc["project_name"]: doc for doc in settings_docs}
    
    result = []
    for d in all_dirs:
        proj_dir = os.path.join(WORKSPACE_DIR, d)
        s = settings_map.get(d, {})
        ptype = detect_project_type(proj_dir, s.get("project_type"))
        result.append({
            "name": d, 
            "is_hidden": s.get("is_hidden", False),
            "project_type": ptype
        })
    return result

@router.post("/")
async def create_project(data: ProjectCreate):
    cleaned_name = data.name.strip().replace("/", "_").replace("\\", "_")
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Invalid project name")
    proj_path = os.path.join(WORKSPACE_DIR, cleaned_name)
    if os.path.exists(proj_path):
        raise HTTPException(status_code=400, detail="Project already exists")
    
    ptype = data.project_type if data.project_type in ["static", "docker", "python"] else "static"
    init_project_structure(proj_path, cleaned_name, ptype)

    await database.db.project_settings.update_one(
        {"project_name": cleaned_name},
        {"$set": {"project_name": cleaned_name, "project_type": ptype, "is_hidden": False, "created_at": datetime.datetime.utcnow().isoformat()}},
        upsert=True
    )

    return {"status": "created", "name": cleaned_name, "project_type": ptype}

@router.delete("/{project_name}")
async def delete_project(project_name: str):
    proj_path = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name))
    base = os.path.abspath(WORKSPACE_DIR)
    
    if not proj_path.startswith(base) or proj_path == base:
        raise HTTPException(status_code=403, detail="Access denied")
        
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")
        
    shutil.rmtree(proj_path)
    await database.db.project_settings.delete_many({"project_name": project_name})
    await database.db.file_history.delete_many({"project_name": project_name})
    await database.db.agent_sessions.delete_many({"project_name": project_name})
    return {"status": "deleted", "name": project_name}

@router.post("/{project_name}/toggle-visibility")
async def toggle_project_visibility(project_name: str):
    doc = await database.db.project_settings.find_one({"project_name": project_name})
    new_hidden_state = not doc.get("is_hidden", False) if doc else True
    await database.db.project_settings.update_one(
        {"project_name": project_name},
        {"$set": {"is_hidden": new_hidden_state}},
        upsert=True
    )
    return {"project_name": project_name, "is_hidden": new_hidden_state}

def scan_dir(base_path: str, current_path: str) -> List[dict]:
    nodes = []
    try:
        entries = sorted(os.scandir(current_path), key=lambda e: (not e.is_dir(), e.name.lower()))
        for entry in entries:
            if entry.name.startswith('.'):
                continue
            rel_path = os.path.relpath(entry.path, base_path)
            node = {
                "name": entry.name,
                "path": rel_path.replace("\\", "/"),
                "is_dir": entry.is_dir(),
                "children": scan_dir(base_path, entry.path) if entry.is_dir() else []
            }
            nodes.append(node)
    except PermissionError:
        pass
    return nodes

@router.get("/{project_name}/tree")
async def get_project_tree(project_name: str, subpath: str = ""):
    proj_path = os.path.join(WORKSPACE_DIR, project_name)
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")

    target_dir = os.path.join(proj_path, subpath.strip("/").strip("\\")) if subpath else proj_path
    if not os.path.exists(target_dir):
        return []

    items = []
    try:
        for entry in sorted(os.scandir(target_dir), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith("."):
                continue
            rel_path = os.path.relpath(entry.path, proj_path).replace("\\", "/")
            if entry.is_dir():
                items.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "directory",
                    "file_type": "other"
                })
            else:
                ext = entry.name.split(".")[-1].lower() if "." in entry.name else ""
                file_type = "image" if ext in ["png", "jpg", "jpeg", "webp", "gif", "svg"] else "code"
                items.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "file",
                    "file_type": file_type
                })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return items

@router.post("/{project_name}/create-item")
def create_file_or_dir(project_name: str, item: CreateItem):
    clean_path = normalize_rel_path(item.path)
    target = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name, clean_path))
    base = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name))
    if not target.startswith(base):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if item.is_dir:
        os.makedirs(target, exist_ok=True)
    else:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if not os.path.exists(target):
            header = get_file_header_comment(os.path.basename(target))
            with open(target, "w", encoding="utf-8") as f:
                f.write(header)
    return {"status": "ok"}

@router.delete("/{project_name}/item")
async def delete_file_or_dir(project_name: str, path: str = Query(...)):
    clean_path = normalize_rel_path(path)
    target = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name, clean_path))
    base = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name))
    if not target.startswith(base) or target == base:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Item not found")
        
    if os.path.isdir(target):
        shutil.rmtree(target)
    else:
        os.remove(target)
    
    await database.db.file_history.delete_many({
        "project_name": project_name, 
        "file_path": {"$in": [clean_path, f"/{clean_path}"]}
    })
    return {"status": "deleted", "path": clean_path}

@router.get("/{project_name}/file")
def read_file(project_name: str, path: str):
    clean_path = normalize_rel_path(path)
    file_path = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name, clean_path))
    base = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name))
    if not file_path.startswith(base) or not os.path.isfile(file_path):
        raise HTTPException(status_code=403, detail="Access denied or file not found")
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return {"content": f.read()}

@router.post("/{project_name}/file")
async def save_file(project_name: str, data: FileWrite):
    clean_path = normalize_rel_path(data.path)
    file_path = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name, clean_path))
    base = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name))
    if not file_path.startswith(base):
        raise HTTPException(status_code=403, detail="Access denied")

    previous_content = None
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            previous_content = f.read()

    if previous_content == data.content:
        return {"status": "no_changes"}

    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(data.content)

    now_dt = datetime.datetime.utcnow()
    timestamp_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    
    insert_res = await database.db.file_history.insert_one({
        "project_name": project_name,
        "file_path": clean_path,
        "content": data.content,
        "created_at": now_dt.isoformat(),
        "timestamp": timestamp_str
    })

    return {
        "status": "ok", 
        "revision": {
            "id": str(insert_res.inserted_id),
            "timestamp": timestamp_str,
            "created_at": now_dt.isoformat(),
            "content": data.content
        }
    }

@router.get("/{project_name}/history")
async def get_file_history(project_name: str, path: str = Query(...)):
    clean_path = normalize_rel_path(path)
    cursor = database.db.file_history.find({
        "project_name": project_name,
        "file_path": {"$in": [clean_path, f"/{clean_path}"]}
    }).sort("created_at", -1)

    history = []
    async for doc in cursor:
        history.append({
            "id": str(doc["_id"]),
            "timestamp": doc.get("timestamp", ""),
            "created_at": doc.get("created_at", ""),
            "content": doc.get("content", "")
        })
    return history

@router.delete("/{project_name}/history")
async def clear_file_history(project_name: str, path: str = Query(...)):
    clean_path = normalize_rel_path(path)
    await database.db.file_history.delete_many({
        "project_name": project_name,
        "file_path": {"$in": [clean_path, f"/{clean_path}"]}
    })
    return {"status": "cleared", "file_path": clean_path}

class SaveImagePayload(BaseModel):
    image_url: str
    target_dir: Optional[str] = ""
    filename: Optional[str] = None

@router.post("/{project_name}/save-image")
async def save_image_to_project(project_name: str, payload: SaveImagePayload):
    proj_path = os.path.join(WORKSPACE_DIR, project_name)
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")

    target_dir_clean = payload.target_dir.strip("/").strip("\\") if payload.target_dir else ""
    target_folder = os.path.join(proj_path, target_dir_clean) if target_dir_clean else proj_path
    os.makedirs(target_folder, exist_ok=True)

    filename = payload.filename or f"generated_{int(datetime.datetime.utcnow().timestamp())}.png"
    if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        filename += ".png"

    dest_file = os.path.join(target_folder, filename)

    try:
        from urllib.parse import urlparse, parse_qs
        comfy_host = os.getenv("COMFYUI_HOST", "host.docker.internal:8188")
        comfy_http = f"http://{comfy_host}"

        parsed = urlparse(payload.image_url)
        params = parse_qs(parsed.query)

        # Если это ссылка на наш view-эндпоинт, берем напрямую из ComfyUI
        if "filename" in params:
            cf_filename = params["filename"][0]
            cf_subfolder = params.get("subfolder", [""])[0]
            cf_type = params.get("type", ["output"])[0]

            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
                r = await client.get(
                    f"{comfy_http}/view",
                    params={"filename": cf_filename, "subfolder": cf_subfolder, "type": cf_type}
                )
                if r.status_code == 200:
                    with open(dest_file, "wb") as f:
                        f.write(r.content)
                else:
                    raise HTTPException(status_code=400, detail=f"ComfyUI returned {r.status_code}")
        elif payload.image_url.startswith("data:image"):
            import base64
            parts = payload.image_url.split(",", 1)
            b64_str = parts[1] if len(parts) > 1 else parts[0]
            with open(dest_file, "wb") as f:
                f.write(base64.b64decode(b64_str))
        else:
            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
                r = await client.get(payload.image_url)
                if r.status_code == 200:
                    with open(dest_file, "wb") as f:
                        f.write(r.content)
                else:
                    raise HTTPException(status_code=400, detail="Cannot download source image")

        rel_path = os.path.relpath(dest_file, proj_path).replace("\\", "/")
        return {"status": "success", "file_path": rel_path, "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
