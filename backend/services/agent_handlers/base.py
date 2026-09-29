from abc import ABC, abstractmethod
from typing import AsyncGenerator, Dict, Any

class BaseAgentHandler(ABC):
    @abstractmethod
    async def handle(self, task, intent_data: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """Генератор SSE-событий для конкретного типа операции"""
        pass
