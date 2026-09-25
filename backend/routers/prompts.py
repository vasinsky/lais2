import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from bson import ObjectId
import database

router = APIRouter()

class PromptItem(BaseModel):
    prompt: str
    is_active: Optional[bool] = True

@router.get("/")
async def list_prompts():
    try:
        cursor = database.db.system_prompts.find().sort("created_at", -1)
        prompts = []
        async for doc in cursor:
            prompts.append({
                "id": str(doc["_id"]),
                "prompt": doc.get("prompt", ""),
                "is_active": doc.get("is_active", True),
                "created_at": doc.get("created_at")
            })
        return prompts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/")
async def create_prompt(data: PromptItem):
    prompt = data.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt text is required")
    
    try:
        created_at_str = datetime.datetime.utcnow().isoformat()
        doc = {
            "prompt": prompt,
            "is_active": True,
            "created_at": created_at_str
        }
        result = await database.db.system_prompts.insert_one(doc)
        return {
            "id": str(result.inserted_id),
            "prompt": prompt,
            "is_active": True,
            "created_at": created_at_str
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{prompt_id}")
async def update_prompt(prompt_id: str, data: PromptItem):
    if not ObjectId.is_valid(prompt_id):
        raise HTTPException(status_code=400, detail="Invalid prompt ID")
    
    prompt = data.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt text cannot be empty")
        
    try:
        update_fields = {
            "prompt": prompt,
            "updated_at": datetime.datetime.utcnow().isoformat()
        }
        if data.is_active is not None:
            update_fields["is_active"] = data.is_active

        res = await database.db.system_prompts.update_one(
            {"_id": ObjectId(prompt_id)},
            {"$set": update_fields}
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {"status": "updated", "id": prompt_id, "prompt": prompt}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{prompt_id}/toggle")
async def toggle_prompt_active(prompt_id: str):
    if not ObjectId.is_valid(prompt_id):
        raise HTTPException(status_code=400, detail="Invalid prompt ID")
    try:
        doc = await database.db.system_prompts.find_one({"_id": ObjectId(prompt_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Prompt not found")
        
        new_state = not doc.get("is_active", True)
        await database.db.system_prompts.update_one(
            {"_id": ObjectId(prompt_id)},
            {"$set": {"is_active": new_state}}
        )
        return {"id": prompt_id, "is_active": new_state}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str):
    if not ObjectId.is_valid(prompt_id):
        raise HTTPException(status_code=400, detail="Invalid prompt ID")
    try:
        res = await database.db.system_prompts.delete_one({"_id": ObjectId(prompt_id)})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
