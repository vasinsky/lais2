import os
import json
from pathlib import Path
from typing import Dict, Any
from mcp.server.fastmcp import FastMCP

PROJECTS_ROOT = Path(os.environ.get("PROJECTS_ROOT_DIR", "/projects")).resolve()
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)

mcp = FastMCP("StudioFilesystem", host="0.0.0.0", port=8010)

def _safe_path(rel_path: str) -> Path:
    clean = rel_path.strip("/")
    target = (PROJECTS_ROOT / clean).resolve()
    if target != PROJECTS_ROOT and not str(target).startswith(str(PROJECTS_ROOT) + os.sep):
        raise ValueError(f"Access denied: path '{rel_path}' is outside projects root")
    return target

@mcp.tool()
def list_files(project: str, subpath: str = "") -> str:
    """List files and directories in a project path as a JSON array."""
    target = _safe_path(f"{project}/{subpath}".strip("/"))
    if not target.exists() or not target.is_dir():
        return "[]"

    items = []
    ignored = {".venv", "__pycache__", ".git", ".pytest_cache"}
    
    for entry in target.iterdir():
        if entry.name in ignored:
            continue
        try:
            rel = entry.relative_to(PROJECTS_ROOT / project.strip("/"))
            is_dir = entry.is_dir()
            size = entry.stat().st_size if not is_dir else 0
            items.append({
                "name": entry.name,
                "path": str(rel),
                "is_dir": is_dir,
                "size": size
            })
        except Exception:
            continue

    items.sort(key=lambda x: (not x["is_dir"], x["name"]))
    return json.dumps(items, ensure_ascii=False)

@mcp.tool()
def read_file(project: str, filepath: str) -> str:
    """Read full text content of a file within a project."""
    target = _safe_path(f"{project}/{filepath}".strip("/"))
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"File '{filepath}' not found in project '{project}'")
    return target.read_text(encoding="utf-8", errors="replace")

@mcp.tool()
def write_file(project: str, filepath: str, content: str) -> str:
    """Write or overwrite content of a file within a project."""
    target = _safe_path(f"{project}/{filepath}".strip("/"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return json.dumps({"status": "ok", "path": filepath, "bytes_written": len(content.encode("utf-8"))})

@mcp.tool()
def delete_file(project: str, filepath: str) -> str:
    """Delete a file or empty directory within a project."""
    target = _safe_path(f"{project}/{filepath}".strip("/"))
    if not target.exists():
        return json.dumps({"status": "not_found", "path": filepath})
    if target.is_dir():
        target.rmdir()
    else:
        target.unlink()
    return json.dumps({"status": "deleted", "path": filepath})

if __name__ == "__main__":
    mcp.run(transport="sse")
