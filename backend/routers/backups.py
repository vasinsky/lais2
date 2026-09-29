import os
import shutil
import zipfile
import re
from datetime import datetime
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/projects/{project_name}/backups", tags=["backups"])

def get_base_dir() -> str:
    env_dir = os.getenv("PROJECTS_ROOT_DIR")
    if env_dir and os.path.exists(env_dir):
        return env_dir
    default_dir = "/app/projects"
    if os.path.exists(default_dir):
        return default_dir
    os.makedirs(default_dir, exist_ok=True)
    return default_dir

def get_project_dir(project_name: str) -> str:
    base = os.path.abspath(get_base_dir())
    proj_dir = os.path.abspath(os.path.join(base, project_name))
    if not proj_dir.startswith(base):
        raise HTTPException(status_code=400, detail="Invalid project path")
    return proj_dir

def get_backups_dir(project_name: str) -> str:
    proj_dir = get_project_dir(project_name)
    backups_dir = os.path.join(proj_dir, ".backups")
    os.makedirs(backups_dir, exist_ok=True)
    return backups_dir

@router.get("")
def list_backups(project_name: str):
    proj_dir = get_project_dir(project_name)
    if not os.path.exists(proj_dir):
        raise HTTPException(status_code=404, detail="Project not found")
    
    b_dir = get_backups_dir(project_name)
    results = []
    
    for filename in sorted(os.listdir(b_dir), reverse=True):
        if filename.endswith(".zip"):
            filepath = os.path.join(b_dir, filename)
            stat = os.stat(filepath)
            
            display_name = filename
            pattern = rf"^{re.escape(project_name)}_(.+)\.zip$"
            match = re.match(pattern, filename)
            if match:
                raw_ts = match.group(1)
                try:
                    dt = datetime.strptime(raw_ts, "%Y-%m-%d_%H-%M-%S")
                    display_name = dt.strftime("%d.%m.%Y %H:%M:%S")
                except Exception:
                    display_name = raw_ts.replace("_", " ")
            
            results.append({
                "filename": filename,
                "display_name": display_name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
            
    return results

@router.post("")
def create_backup(project_name: str):
    proj_dir = get_project_dir(project_name)
    if not os.path.exists(proj_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    b_dir = get_backups_dir(project_name)
    now_str = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    archive_name = f"{project_name}_{now_str}.zip"
    archive_path = os.path.join(b_dir, archive_name)

    ignored_dirs = {".backups", ".git", ".venv", "__pycache__", "node_modules"}

    try:
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(proj_dir):
                dirs[:] = [d for d in dirs if d not in ignored_dirs]
                for file in files:
                    full_path = os.path.join(root, file)
                    arcname = os.path.relpath(full_path, proj_dir)
                    zipf.write(full_path, arcname)
    except Exception as e:
        if os.path.exists(archive_path):
            os.remove(archive_path)
        raise HTTPException(status_code=500, detail=f"Failed to create backup: {str(e)}")

    stat = os.stat(archive_path)
    dt = datetime.strptime(now_str, "%Y-%m-%d_%H-%M-%S")

    return {
        "filename": archive_name,
        "display_name": dt.strftime("%d.%m.%Y %H:%M:%S"),
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
    }

@router.post("/{filename}/restore")
def restore_backup(project_name: str, filename: str):
    proj_dir = get_project_dir(project_name)
    b_dir = get_backups_dir(project_name)
    archive_path = os.path.join(b_dir, filename)

    if not os.path.exists(archive_path) or not filename.endswith(".zip"):
        raise HTTPException(status_code=404, detail="Backup file not found")

    try:
        for item in os.listdir(proj_dir):
            if item == ".backups":
                continue
            item_path = os.path.join(proj_dir, item)
            if os.path.isdir(item_path):
                shutil.rmtree(item_path)
            else:
                os.remove(item_path)

        with zipfile.ZipFile(archive_path, "r") as zipf:
            zipf.extractall(proj_dir)

        return {"status": "success", "message": f"Backup {filename} successfully restored"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restore backup: {str(e)}")

@router.delete("/{filename}")
def delete_backup(project_name: str, filename: str):
    b_dir = get_backups_dir(project_name)
    archive_path = os.path.join(b_dir, filename)

    if not os.path.exists(archive_path) or not filename.endswith(".zip"):
        raise HTTPException(status_code=404, detail="Backup file not found")

    try:
        os.remove(archive_path)
        return {"status": "success", "message": f"Backup {filename} deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete backup: {str(e)}")
