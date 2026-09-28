<p align="center">
  <img src="images/banner.svg" alt="Local AI Studio Banner" width="100%" />
</p>

# Local AI Studio

Self-hosted AI Development Environment: Autonomous Code Assistant & Visual Generation.

[English](#english) | [Русский](#русский)

---

## English

> ### ⚠️ WORK IN PROGRESS / IN ACTIVE DEVELOPMENT
> **Notice:** This project is currently in early active development. APIs, architecture, and UI features are subject to frequent changes and improvements.

### Overview
Local AI Studio is a self-hosted workspace combining local Large Language Models (LLMs via Ollama) and image generation pipelines (ComfyUI). It provides a full developer workflow for creating, running, refactoring, and previewing code alongside AI-assisted visual asset production—all containerized and private.

### Architecture & Key Features
- **Decoupled Containerization:** Microservices architecture with FastAPI (backend), React/Vite (frontend), and MongoDB (mongo) managed by Docker Compose.
- **Unified Project Lifecycle Management:** Native runtime controls (Start/Stop) for Docker Compose and Python services directly from the project explorer.
- **Multi-Engine Interactive Preview:** Automatic routing between static HTML renderers, external Docker exposed ports, and an integrated FastAPI reverse-proxy for background Python applications with cache-busting (?_t=timestamp).
- **Dual-Pane Bottom Workspace:** Interactive xterm.js terminal alongside an API diagnostic Console with per-project request/response tracing, collapsible view, and vertical resizing.
- **Instant Chat-Driven Project Scaffolding:** Create structured projects directly through natural language chat commands or manually via the project tree.
- **Agentic Code Generation & Editing:** Autonomous LLM-driven file manipulation, project tree navigation, and code history revision tracking with snapshot recovery.
- **Integrated Image Pipeline:** Prompt-to-image workflow directly within the workspace with built-in asset storage and base64 hover previews.
- **Context Isolation & Overflow Protection:** Dual-layer memory architecture: MongoDB preserves 100% of historical messages and Base64 media, while the inference context window dynamically suppresses historical image payloads and uses a 16,384-token sliding window (num_ctx: 16384) to prevent context exhaustion.

---

### Supported Project Types & Scaffolding

You can scaffold projects on the fly using natural language commands in the Global Chat (English or Russian), or create directories manually using the New Project button in the sidebar:

#### 1. Static Web Project
- **Chat Triggers:** `create static project <name>`, `создай статичный проект <имя>`
- **Generated Templates:**
  - `index.html` (semantic HTML5 boilerplate with stylesheet and script links)
  - `images/` (empty directory for visual assets)
  - `css/style.css` (modern reset and dark theme starter styling)
  - `js/script.js` (DOM initialization listener)
- **Lifecycle & Execution:** No server process required. Served directly by the backend preview handler.

#### 2. Docker Compose Project
- **Chat Triggers:** `create docker project <name>`, `создай докер проект <имя>`
- **Generated Templates:**
  - `app/index.html` (sample web document)
  - `docker-compose.yml` (production-ready `nginx:alpine` container with port `8080:80` and `./app` volume mount)
- **Lifecycle & Execution:** Controlled via `POST /api/projects/{name}/compose/up` and `POST /api/projects/{name}/compose/down`.

#### 3. Python Project
- **Chat Triggers:** `create python project <name>`, `создай пайтон проект <имя>`
- **Generated Templates:**
  - `main.py` (`def main():` entrypoint or lightweight HTTP server listening to dynamic `os.environ["PORT"]`)
  - `requirements.txt` (standard dependencies: `requests`, `pydantic`, `python-dotenv`)
- **Lifecycle & Execution:** Managed by the backend Process Manager (`POST /api/projects/{name}/python/start` and `stop`), executing in the background with dynamic port allocation (8050–8099).

---

### Project Preview System

Clicking the Preview button (external link icon) next to any project resolves automatically depending on the project type:

1. **Docker Compose Projects:** When running, reads the exposed host port from container metadata (e.g. `8080`) and opens `http://<host>:<port>/?_t=<timestamp>`.
2. **Python Projects:** Routes through the built-in transparent reverse-proxy:
   `http://<host>:8000/api/projects/<name>/python/proxy/?_t=<timestamp>`
   This forwards requests directly to the internal loopback port (`127.0.0.1:<allocated_port>`) without requiring manual Docker port exposure on macOS host.
3. **Static Projects:** Opens the static HTML renderer endpoint:
   `http://<host>:8000/api/projects/<name>/preview/?_t=<timestamp>`

*Note: All preview URLs append a timestamp query parameter (?_t=Date.now()) to ensure browser cache busting.*

---

### Bottom Drawer: Terminal & API Debug Console

The bottom area occupies 1/3 of the central workspace, supports vertical resizing, and can be collapsed or expanded at any time:

- **Terminal Tab:**
  - Full VT100/ANSI emulation with xterm.js and WebSocket PTY sessions.
  - Automatically synchronizes working directory to `projects/<selected-project>`.
  - Shell reload and screen clear buttons.
- **Console Tab (API Debugger):**
  - Live inspection stream of lifecycle API calls (`compose/up`, `compose/down`, `python/start`, `python/stop`).
  - Color-coded badges for HTTP requests (`-> REQ`), responses (`<- RES 200`), status codes, and execution latency (`ms`).
  - Collapsible JSON payloads for both requests and server responses.
  - **Per-Project Isolation:** Each project maintains its own isolated event history.
  - **Clear Button:** Clears logged events for the currently active project.

---

### Prerequisites & External Services

#### 1. Ollama Setup (LLMs & Translation)
Ollama runs locally outside or inside your environment:
- **Code & Chat Model:** `qwen2.5-coder:7b` (or `deepseek-coder-v2`, `llama3.1`).
- **Translation Bridge:** Prompt enrichment uses two integrated models (e.g. `qwen2.5:7b` / `llama3.2`) to bridge multilingual developer prompts into optimized English ComfyUI tags.

Recommended models:
- `ollama pull qwen2.5-coder:7b`
- `ollama pull llama3.2:latest`

#### 2. ComfyUI Setup (Image Generation)
Make sure ComfyUI is running with API access enabled (`--listen 0.0.0.0`):
- **Custom Nodes:** ComfyUI-Manager, ComfyUI-Custom-Scripts.
- **Checkpoints:** SDXL, SD1.5 or Flux checkpoints in `ComfyUI/models/checkpoints/`.

---

### Quick Start & Deployment

1. Clone the repository:
   `git clone <repo-url> local-ai-studio`
   `cd local-ai-studio`

2. Configure Environment:
   `cp .env.example .env`

Key variables:
- `PROJECTS_DIR=./projects`
- `BACKEND_PORT=8000`
- `FRONTEND_PORT=3000`
- `MONGO_PORT=27017`
- `OLLAMA_URL=http://host.docker.internal:11434`
- `COMFY_URL=http://host.docker.internal:8188`
- `MONGO_URI=mongodb://mongo:27017/local_ai_studio`
- `DEFAULT_CODER_MODEL=qwen2.5-coder:7b-instruct-q4_K_M`
- `TRANSLATOR_MODEL=dolphin-llama3:latest`
- `VISION_MODEL=minicpm-v:latest`

3. Run via Docker Compose:
   `docker compose up -d`

Open `http://localhost:3000` in your browser.

---

## Русский

> ### ⚠️ ВНИМАНИЕ: ПРОЕКТ НАХОДИТСЯ В СТАДИИ РАЗРАБОТКИ
> **Примечание:** Проект находится в стадии активной разработки и тестирования (WIP). Интерфейс, логика работы агентов и структура API могут активно изменяться и дополняться.

### Описание проекта
Local AI Studio — это локальная среда разработки и генерации, объединяющая возможности локальных языковых моделей (LLM через Ollama) и генерации изображений (ComfyUI). Платформа предоставляет единый интерфейс для кодогенерации, навигации по проектам, версионирования файлов, управления жизненным циклом сервисов и создания графических ассетов без передачи данных в публичные облака.

### Архитектура и функционал
- **Полная контейнеризация:** Микросервисная архитектура FastAPI (бэкенд), React/Vite (фронтенд) и MongoDB (база данных) под управлением Docker Compose.
- **Единое управление запуском и остановкой:** Кнопки запуска и остановки (Play / Stop) прямо в дереве проектов для контейнеров Docker Compose и фоновых скриптов Python.
- **Умная система интерактивного превью:** Автоматическая маршрутизация между статическими HTML-файлами, внешними портами Docker и встроенным Reverse-proxy для Python с автоматическим сбросом кэша браузера (?_t=timestamp).
- **Нижняя панель (Terminal + Console):** Сплит-панель с полноценным веб-терминалом на базе xterm.js и окном диагностической консоли для отслеживания API-запросов запуска/остановки с индивидуальной историей по проектам.
- **Генерация шаблонов проектов через чат:** Мгновенная инициализация проектов по текстовым запросам или вручную через интерфейс.
- **Агентное редактирование кода:** Ассистент анализирует контекст файлов, создаёт правки и фиксирует снимки истории (Revision History) с возможностью быстрого отката.
- **Интегрированная генерация изображений:** Встроенный интерфейс создания картинок через ComfyUI с сохранением в папку активного проекта и предпросмотром при наведении.
- **Защита контекста от переполнения:** MongoDB сохраняет полную историю сообщений и Base64-вложений, тогда как в окно LLM инференса передается скользящее окно с изоляцией тяжелых картинок и лимитом в 16 384 токенов (num_ctx: 16384).

---

### Поддерживаемые типы проектов и шаблоны

Создать проект можно с помощью текстовой команды в общем чате или нажатием кнопки «New Project» в боковой панели:

#### 1. Статичный веб-проект (Static)
- **Команды в чате:** `создай статичный проект <имя>`, `create static project <name>`
- **Шаблоны файлов:**
  - `index.html` (семантическая разметка HTML5 с подключением CSS и JS)
  - `images/` (папка для графических ассетов)
  - `css/style.css` (базовые стили и тёмная тема)
  - `js/script.js` (обработчик события загрузки DOM)
- **Запуск:** Не требует серверного процесса, обслуживается встроенным статическим обработчиком.

#### 2. Docker-проект (Docker Compose)
- **Команды в чате:** `создай докер проект <имя>`, `create docker project <name>`
- **Шаблоны файлов:**
  - `app/index.html` (стартовая веб-страница сервиса)
  - `docker-compose.yml` (контейнер `nginx:alpine` с пробросом порта `8080:80` и монтированием каталога `./app`)
- **Запуск и остановка:** Управляются кнопками в дереве проектов через эндпоинты `/api/projects/{name}/compose/up` и `/compose/down`.

#### 3. Python-проект (Python)
- **Команды в чате:** `создай пайтон проект <имя>`, `create python project <name>`
- **Шаблоны файлов:**
  - `main.py` (точка входа или HTTP-сервер, слушающий порт из переменной окружения `os.environ.get("PORT")`)
  - `requirements.txt` (зависимости: `requests`, `pydantic`, `python-dotenv`)
- **Запуск и остановка:** Управляются встроенным менеджером процессов бэкенда (`/api/projects/{name}/python/start` и `/stop`) с автоматическим выделением свободного порта из диапазона 8050–8099.

---

### Механизм интерактивного превью (Preview)

Нажатие на кнопку Preview (иконка внешней ссылки со стрелкой) автоматически определяет тип проекта:

1. **Docker Compose:** Если контейнеры запущены, считывается внешний порт (например, `8080`) и в новой вкладке открывается `http://<host>:<port>/?_t=<timestamp>`.
2. **Python-проекты:** Запрос направляется на встроенный прозрачный reverse-proxy бэкенда:
   `http://<host>:8000/api/projects/<name>/python/proxy/?_t=<timestamp>`
   Бэкенд сам перенаправляет трафик на локальный порт процесса (`127.0.0.1:<port>`) внутри контейнера без ручного проброса портов в Compose.
3. **Статические проекты:** Открывается прямой роут предпросмотра:
   `http://<host>:8000/api/projects/<name>/preview/?_t=<timestamp>`

*Каждый URL снабжён меткой времени `?_t=Date.now()`, предотвращающей кэширование браузером.*

---

### Нижняя панель: Terminal и отладочная Console

Нижняя область занимает 1/3 высоты центрального экрана, масштабируется мышью по высоте и сворачивается в полосу:

- **Вкладка Terminal:**
  - Полноценная эмуляция VT100/ANSI на xterm.js через WebSocket PTY.
  - Автоматическая смена рабочей директории на `projects/<выбранный-проект>`.
  - Кнопки перезапуска сессии и очистки экрана.
- **Вкладка Console (Дебаггер API):**
  - Живое логирование вызовов запуска и остановки (`compose/up`, `compose/down`, `python/start`, `python/stop`).
  - Цветовая индикация запросов (`-> REQ`), ответов (`<- RES 200`), ошибок (`X ERR`) и миллисекунд выполнения.
  - JSON-просмотр тел запросов и ответов бэкенда.
  - **Раздельная история по проектам:** У каждого проекта свой независимый журнал логов.
  - **Кнопка очистки:** Сбрасывает журнал активного проекта.

---

### Развертывание и запуск

1. Клонирование репозитория:
   `git clone <repo-url> local-ai-studio`
   `cd local-ai-studio`

2. Файл переменных окружения:
   `cp .env.example .env`

3. Запуск контейнеров:
   `docker compose up -d`

Студия откроется по адресу `http://localhost:3000`.
