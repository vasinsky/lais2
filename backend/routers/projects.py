import os
import shutil
import datetime
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List
from bson import ObjectId
import database

router = APIRouter()
WORKSPACE_DIR = os.getenv("PROJECTS_ROOT_DIR", "/app/workspace")

class ProjectCreate(BaseModel):
    name: str

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
    
    if ext in ['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.php', '.swift', '.kt', '.scala', '.dart']:
        return f"// {tag}\n\n"
    elif ext in ['.py', '.sh', '.bash', '.zsh', '.rb', '.pl', '.yaml', '.yml', '.toml', '.r', '.dockerfile', '.env'] or filename.lower() in ['dockerfile', 'makefile']:
        return f"# {tag}\n\n"
    elif ext in ['.html', '.htm', '.xml', '.svg', '.vue']:
        return f"<!-- {tag} -->\n\n"
    elif ext in ['.css', '.scss', '.sass', '.less']:
        return f"/* {tag} */\n\n"
    elif ext in ['.sql', '.lua', '.hs']:
        return f"-- {tag}\n\n"
    return f"# {tag}\n\n"

@router.get("/")
async def list_projects():
    if not os.path.exists(WORKSPACE_DIR):
        os.makedirs(WORKSPACE_DIR, exist_ok=True)
    all_dirs = sorted([d for d in os.listdir(WORKSPACE_DIR) if os.path.isdir(os.path.join(WORKSPACE_DIR, d)) and not d.startswith('.')])
    
    hidden_docs = await database.db.project_settings.find({"is_hidden": True}).to_list(length=1000)
    hidden_set = {doc["project_name"] for doc in hidden_docs}
    
    return [{"name": d, "is_hidden": d in hidden_set} for d in all_dirs]

@router.post("/")
def create_project(data: ProjectCreate):
    cleaned_name = data.name.strip().replace("/", "_").replace("\\", "_")
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Invalid project name")
    proj_path = os.path.join(WORKSPACE_DIR, cleaned_name)
    if os.path.exists(proj_path):
        raise HTTPException(status_code=400, detail="Project already exists")
    os.makedirs(proj_path, exist_ok=True)
    
    header = get_file_header_comment("README.md")
    with open(os.path.join(proj_path, "README.md"), "w", encoding="utf-8") as f:
        f.write(f"{header}# {cleaned_name}\n\nProject initialized in Local AI Studio.\n")
    return {"status": "created", "name": cleaned_name}

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
def get_file_tree(project_name: str):
    proj_path = os.path.join(WORKSPACE_DIR, project_name)
    if not os.path.exists(proj_path):
        raise HTTPException(status_code=404, detail="Project not found")
    return scan_dir(proj_path, proj_path)

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
