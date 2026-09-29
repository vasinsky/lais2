import os
import json
import re
import time
import asyncio
import httpx
from typing import Dict, Any, List, Optional
from services.event_bus import project_event_bus

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://mcp-server:8010")

class MCPClient:
    def __init__(self, base_url: str = MCP_SERVER_URL):
        self.base_url = base_url.rstrip("/")
        self._post_endpoint: Optional[str] = None
        self._sse_task: Optional[asyncio.Task] = None
        self._pending_requests: Dict[int, asyncio.Future] = {}
        self._req_id = 0
        self._lock = asyncio.Lock()
        self._ready_event = asyncio.Event()
        self._initialized = False

    def _get_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=60.0, trust_env=False)

    async def start(self):
        if self._initialized and self._sse_task and not self._sse_task.done():
            return

        self._ready_event.clear()
        self._initialized = False
        if self._sse_task and not self._sse_task.done():
            self._sse_task.cancel()

        self._sse_task = asyncio.create_task(self._listen_sse())
        await asyncio.wait_for(self._ready_event.wait(), timeout=10.0)

        init_fut = asyncio.get_event_loop().create_future()
        async with self._lock:
            self._req_id += 1
            init_id = self._req_id
        self._pending_requests[init_id] = init_fut

        init_payload = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "LocalAIStudioClient",
                    "version": "1.0.0"
                }
            },
            "id": init_id
        }

        target_url = f"{self.base_url}{self._post_endpoint}"
        async with self._get_client() as client:
            resp = await client.post(target_url, json=init_payload)
            if resp.status_code not in (200, 202):
                self._pending_requests.pop(init_id, None)
                raise RuntimeError(f"MCP initialize POST failed ({resp.status_code}): {resp.text}")

        await asyncio.wait_for(init_fut, timeout=10.0)

        notify_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }
        async with self._get_client() as client:
            await client.post(target_url, json=notify_payload)

        self._initialized = True

    async def _listen_sse(self):
        while True:
            try:
                async with self._get_client() as client:
                    async with client.stream("GET", f"{self.base_url}/sse") as response:
                        event_type = "message"
                        async for line in response.aiter_lines():
                            line = line.strip()
                            if not line:
                                continue
                            if line.startswith("event:"):
                                event_type = line.split(":", 1)[1].strip()
                            elif line.startswith("data:"):
                                data_str = line.split(":", 1)[1].strip()
                                if event_type == "endpoint":
                                    self._post_endpoint = data_str
                                    self._ready_event.set()
                                elif event_type == "message":
                                    try:
                                        msg = json.loads(data_str)
                                        msg_id = msg.get("id")
                                        if msg_id in self._pending_requests:
                                            fut = self._pending_requests.pop(msg_id)
                                            if not fut.done():
                                                fut.set_result(msg)
                                    except Exception:
                                        pass
            except asyncio.CancelledError:
                break
            except Exception:
                self._ready_event.clear()
                self._initialized = False
                await asyncio.sleep(2.0)

    async def _call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        project = arguments.get("project", "general")
        endpoint_display = f"MCP://tools/{name}"
        t0 = time.time()

        # Эмитим лог запроса в консоль
        await project_event_bus.emit(project, {
            "project": project,
            "type": "request",
            "method": f"MCP:{name}",
            "url": endpoint_display,
            "payload": {k: v for k, v in arguments.items() if k != "content"}
        })

        try:
            await self.start()

            async with self._lock:
                self._req_id += 1
                cur_id = self._req_id

            fut = asyncio.get_event_loop().create_future()
            self._pending_requests[cur_id] = fut

            payload = {
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {
                    "name": name,
                    "arguments": arguments
                },
                "id": cur_id
            }

            target_url = f"{self.base_url}{self._post_endpoint}"
            async with self._get_client() as client:
                resp = await client.post(target_url, json=payload)
                if resp.status_code not in (200, 202):
                    self._pending_requests.pop(cur_id, None)
                    raise RuntimeError(f"MCP message POST failed ({resp.status_code}): {resp.text}")

            res_msg = await asyncio.wait_for(fut, timeout=30.0)
            duration_ms = int((time.time() - t0) * 1000)

            if "error" in res_msg:
                err_detail = str(res_msg['error'])
                await project_event_bus.emit(project, {
                    "project": project,
                    "type": "error",
                    "method": f"MCP:{name}",
                    "url": endpoint_display,
                    "status": 500,
                    "durationMs": duration_ms,
                    "payload": {"error": err_detail}
                })
                raise RuntimeError(f"MCP Error: {err_detail}")

            result = res_msg.get("result", {})
            content = result.get("content", [])
            parsed_data = result

            if isinstance(content, list) and len(content) > 0:
                text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                if text_parts:
                    res_str = "".join(text_parts).strip()
                    try:
                        parsed_data = json.loads(res_str)
                    except Exception:
                        try:
                            objs = [json.loads(b) for b in re.findall(r'\{.*?\}', res_str, re.DOTALL)]
                            if objs:
                                parsed_data = objs
                            else:
                                parsed_data = res_str
                        except Exception:
                            parsed_data = res_str

            # Эмитим лог успешного ответа
            summary_payload = parsed_data
            if isinstance(parsed_data, list):
                summary_payload = {"count": len(parsed_data), "items": parsed_data[:5]}
            elif isinstance(parsed_data, str) and len(parsed_data) > 120:
                summary_payload = {"chars": len(parsed_data), "preview": parsed_data[:80] + "..."}

            await project_event_bus.emit(project, {
                "project": project,
                "type": "response",
                "method": f"MCP:{name}",
                "url": endpoint_display,
                "status": 200,
                "durationMs": duration_ms,
                "payload": summary_payload
            })

            return parsed_data

        except Exception as e:
            duration_ms = int((time.time() - t0) * 1000)
            await project_event_bus.emit(project, {
                "project": project,
                "type": "error",
                "method": f"MCP:{name}",
                "url": endpoint_display,
                "status": 500,
                "durationMs": duration_ms,
                "payload": {"error": str(e)}
            })
            raise

    async def list_files(self, project: str, subpath: str = "") -> List[Dict[str, Any]]:
        res = await self._call_tool("list_files", {"project": project, "subpath": subpath})
        if isinstance(res, list):
            return res
        if isinstance(res, str):
            try:
                parsed = json.loads(res)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
        return []

    async def read_file(self, project: str, filepath: str) -> str:
        res = await self._call_tool("read_file", {"project": project, "filepath": filepath})
        return str(res) if res is not None else ""

    async def write_file(self, project: str, filepath: str, content: str) -> Dict[str, Any]:
        res = await self._call_tool("write_file", {"project": project, "filepath": filepath, "content": content})
        if isinstance(res, str):
            try:
                return json.loads(res)
            except Exception:
                return {"raw": res}
        return res if isinstance(res, dict) else {"status": "ok"}

    async def delete_file(self, project: str, filepath: str) -> Dict[str, Any]:
        res = await self._call_tool("delete_file", {"project": project, "filepath": filepath})
        if isinstance(res, str):
            try:
                return json.loads(res)
            except Exception:
                return {"raw": res}
        return res if isinstance(res, dict) else {"status": "deleted"}

    @staticmethod
    def parse_fallback_tool_calls(text: str) -> List[Dict[str, Any]]:
        calls = []
        xml_matches = re.finditer(r'<tool_call\s+name=[\"\x27](.+?)[\"\x27]>(.*?)</tool_call>', text, re.DOTALL)
        for m in xml_matches:
            name = m.group(1).strip()
            raw_args = m.group(2).strip()
            try:
                args = json.loads(raw_args)
                calls.append({"name": name, "arguments": args})
            except Exception:
                pass

        json_block_matches = re.finditer(r'```(?:json:tool_call|tool_call)\s*\n(.*?)\n```', text, re.DOTALL)
        for m in json_block_matches:
            raw_block = m.group(1).strip()
            try:
                data = json.loads(raw_block)
                if "name" in data and "arguments" in data:
                    calls.append(data)
            except Exception:
                pass

        return calls

mcp_client = MCPClient()
