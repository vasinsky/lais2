import os
import shutil
import tempfile
import asyncio
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from httpx import AsyncClient, ASGITransport

import database
import routers.chat as chat_router
import routers.projects as projects_router
import routers.agent as agent_router
from main import app

TEST_DB_NAME = "studio_test"
PROD_DB_NAME = os.getenv("MONGO_DB_NAME", "studio_ai")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://host.docker.internal:27017")

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_environment(event_loop):
    test_workspace = tempfile.mkdtemp(prefix="studio_test_ws_")
    os.environ["PROJECTS_ROOT_DIR"] = test_workspace

    # Синхронизируем пути во всех трех роутерах
    old_chat_ws = getattr(chat_router, "WORKSPACE_DIR", "/app/workspace")
    old_proj_ws = getattr(projects_router, "WORKSPACE_DIR", "/app/workspace")
    old_agent_ws = getattr(agent_router, "WORKSPACE_DIR", "/app/workspace")

    chat_router.WORKSPACE_DIR = test_workspace
    projects_router.WORKSPACE_DIR = test_workspace
    agent_router.WORKSPACE_DIR = test_workspace

    client = AsyncIOMotorClient(MONGO_URL)
    prod_db = client[PROD_DB_NAME]
    test_db = client[TEST_DB_NAME]

    try:
        async for prompt in prod_db.system_prompts.find():
            await test_db.system_prompts.insert_one(prompt)
    except Exception:
        pass

    database.db = test_db

    yield {
        "client": client,
        "test_db": test_db,
        "workspace": test_workspace
    }

    try:
        await client.drop_database(TEST_DB_NAME)
    except Exception:
        pass
    client.close()

    chat_router.WORKSPACE_DIR = old_chat_ws
    projects_router.WORKSPACE_DIR = old_proj_ws
    agent_router.WORKSPACE_DIR = old_agent_ws

    if os.path.exists(test_workspace):
        shutil.rmtree(test_workspace)

@pytest_asyncio.fixture(scope="function", autouse=True)
async def ensure_db_per_test():
    client = AsyncIOMotorClient(MONGO_URL)
    database.db = client[TEST_DB_NAME]
    yield
    client.close()

@pytest_asyncio.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
