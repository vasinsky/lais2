import os
import pty
import select
import struct
import fcntl
import termios
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from routers.projects import get_base_dir

router = APIRouter()

@router.websocket("/ws")
async def terminal_websocket(websocket: WebSocket, project: str | None = None, mode: str | None = "chat"):
    await websocket.accept()

    # Определяем рабочую директорию:
    # Если режим agent и выбран проект -> открываем в /app/projects/<project>
    # Если режим chat или проект не выбран -> в общей папке проектов
    if mode == "agent" and project:
        target_dir = os.path.join(get_base_dir(), project)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)
        cwd = target_dir
    else:
        cwd = get_base_dir()
        os.makedirs(cwd, exist_ok=True)

    # Создаем pty (псевдотерминал)
    master_fd, slave_fd = pty.openpty()

    shell = os.environ.get("SHELL", "/bin/bash")
    if not os.path.exists(shell):
        shell = "/bin/sh"

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    pid = os.fork()
    if pid == 0:
        # Дочерний процесс
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        try:
            os.chdir(cwd)
        except Exception:
            pass
        os.execvpe(shell, [shell], env)
    else:
        # Родительский процесс (FastAPI loop)
        os.close(slave_fd)

        # Неблокирующий режим для master_fd
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        loop = asyncio.get_event_loop()

        async def read_from_pty():
            try:
                while True:
                    await asyncio.sleep(0.015)
                    try:
                        data = os.read(master_fd, 4096)
                        if not data:
                            break
                        await websocket.send_text(data.decode("utf-8", errors="replace"))
                    except (BlockingIOError, InterruptedError):
                        continue
            except Exception:
                pass

        read_task = asyncio.create_task(read_from_pty())

        try:
            while True:
                msg = await websocket.receive_text()
                # Обработка командного протокола (например, resize)
                if msg.startswith("__RESIZE__:"):
                    try:
                        _, cols, rows = msg.split(":")
                        c, r = int(cols), int(rows)
                        winsize = struct.pack("HHHH", r, c, 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                    except Exception:
                        pass
                else:
                    os.write(master_fd, msg.encode("utf-8"))
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            read_task.cancel()
            try:
                os.close(master_fd)
            except Exception:
                pass
            try:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
            except Exception:
                pass
