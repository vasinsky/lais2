import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import system, projects, chat, agent, prompts
import database

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Инициализация подключения к MongoDB и индексов при старте
    await database.init_db()
    yield

app = FastAPI(title="Local AI Studio API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/api/status", tags=["system"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(prompts.router, prefix="/api/prompts", tags=["prompts"])

@app.get("/health")
def health_check():
    return {"status": "ok"}
