import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongo:27017/local_ai_studio")
client: AsyncIOMotorClient = None
db = None

async def init_db():
    global client, db
    client = AsyncIOMotorClient(MONGO_URI)
    db = client.get_default_database()
    
    # Индексы для сессий проектов и истории сообщений
    await db.chat_threads.create_index("updated_at")
    await db.agent_sessions.create_index([("project_id", 1)])
    await db.projects.create_index("name", unique=True)
