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
Local AI Studio is a self-hosted workspace combining local Large Language Models (LLMs via Ollama) and image generation pipelines (ComfyUI). It provides a full developer workflow for creating, refactoring, and previewing code alongside AI-assisted visual asset production—all containerized and private.

### Architecture & Key Features
- **Decoupled Containerization:** Microservices architecture with FastAPI (backend), React/Vite (frontend), and MongoDB (mongo) managed by Docker Compose.
- **Embedded Web Terminal:** Interactive bottom terminal powered by `xterm.js` and WebSocket PTY sessions with dynamic project working directory synchronization (`projects/<active-project>`) and native Git support.
- **Instant Chat-Driven Project Scaffolding:** Create structured projects directly through natural language chat commands or manually via the project tree.
- **Agentic Code Generation & Editing:** Autonomous LLM-driven file manipulation, project tree navigation, and code history revision tracking with snapshot recovery.
- **Integrated Image Pipeline:** Prompt-to-image workflow directly within the workspace with built-in asset storage and base64 hover previews.
- **Configurable Workspace Paths:** Dynamic host-to-container volume mapping for workspace projects.
- **Context Isolation & Overflow Protection:** Dual-layer memory architecture: MongoDB preserves 100% of historical messages and Base64 media, while the inference context window dynamically suppresses historical image payloads and uses a 16,384-token sliding window (`num_ctx: 16384`) to prevent context exhaustion.

---


---

### Project Scaffolding via Chat & Tree Navigation
You can scaffold projects on the fly using natural language commands in the Global Chat (English or Russian), or create directories manually using the **New Project** button in the sidebar:

- **Static Web Project:**
  - *Trigger prompts:* `create static project <name>`, `создай статичный проект <имя>`
  - *Generated structure:*
    - `index.html` (semantic HTML5 boilerplate with stylesheet and script links)
    - `images/` (empty directory for visual assets)
    - `css/style.css` (modern reset and dark theme starter styling)
    - `js/script.js` (DOM initialization listener)
- **Docker Compose Project:**
  - *Trigger prompts:* `create docker project <name>`, `создай докер проект <имя>`
  - *Generated structure:*
    - `app/index.html` (sample web document)
    - `docker-compose.yml` (production-ready `nginx:alpine` container with port `8080:80` and `./app` volume mount)
- **Python Project:**
  - *Trigger prompts:* `create python project <name>`, `создай пайтон проект <имя>`
  - *Generated structure:*
    - `main.py` (`def main():` entrypoint)
    - `requirements.txt` (standard dependencies: `requests`, `pydantic`, `python-dotenv`)

All template files are generated strictly in English with immediate context initialization in the Project Agent tab.

---

### Embedded PTY Terminal
The bottom drawer features an interactive terminal:
- **xterm.js Integration:** Full VT100/ANSI terminal emulation with resize support and real-time PTY communication over WebSockets.
- **Dynamic CWD Sync:** Automatically switches directories to `projects/<selected-project>` upon project selection.
- **Pre-installed Tooling:** Includes native `git`, shell utilities, and container inspection tools.

### Prerequisites & External Services

#### 1. Ollama Setup (LLMs & Translation)
Ollama runs locally outside or inside your environment. The studio uses specialized models for reasoning and text processing:
- **Code & Chat Model:** `qwen2.5-coder:7b` (or `deepseek-coder-v2`, `llama3.1`).
- **Built-in Translation Models (Two-stage bridge):** Prompt enrichment uses two integrated models (e.g. `qwen2.5:7b` / `llama3.2`) to bridge Russian/multilingual developer prompts to optimized English ComfyUI prompts.

Pull recommended models:
```bash
ollama pull qwen2.5-coder:7b
ollama pull llama3.2:latest
```

#### 2. ComfyUI Setup (Image Generation)
Make sure ComfyUI is running with API access enabled (`--listen 0.0.0.0`).
- **Required Custom Nodes:**
  - ComfyUI-Manager
  - ComfyUI-Custom-Scripts
- **Required Checkpoints / Models:**
  - Standard SDXL / SD1.5 or Flux checkpoints in `ComfyUI/models/checkpoints/` (e.g., `sd_xl_base_1.0.safetensors`).
  - Corresponding VAE and CLIP models according to your generation workflow.

---

### Quick Start & Deployment

1. **Clone the repository:**
```bash
git clone <repo-url> local-ai-studio
cd local-ai-studio
```

2. **Configure Environment (.env):**
```bash
cp .env.example .env
```
Key variables in `.env`:
```env
# Local directory on host to mount projects into workspace
PROJECTS_DIR=./projects

# Port bindings
BACKEND_PORT=8000
FRONTEND_PORT=3000
MONGO_PORT=27017

# Integration endpoints
OLLAMA_URL=http://host.docker.internal:11434
COMFY_URL=http://host.docker.internal:8188
MONGO_URI=mongodb://mongo:27017/local_ai_studio

# Configurable LLM & Vision Models
DEFAULT_CODER_MODEL=qwen2.5-coder:7b-instruct-q4_K_M
TRANSLATOR_MODEL=dolphin-llama3:latest
VISION_MODEL=minicpm-v:latest
```

3. **Run via Docker Compose:**
```bash
docker compose up -d
```
Open `http://localhost:3000` in your browser.

---

### Image Processing & Multimodal Chat Workflow
The studio features a hybrid multimodal pipeline separating visual technical analysis from image synthesis:
- **Visual Analysis (`minicpm-v`):** When attaching images/screenshots with questions (e.g., *"what is in this picture?"*, *"analyze UI layout"*), `minicpm-v` processes sanitized Base64 data and delivers a structured Russian response detailing UI components, layout, and color schemes.
- **Text-to-Image Generation (ComfyUI + `dolphin-llama3`):** Prompts like *"draw a cat"* or *"create an image of a cyberpunk city"* route to ComfyUI. Multilingual and Russian prompts are enriched and translated by `dolphin-llama3` into high-quality, comma-separated English Stable Diffusion tags.
- **Image-to-Image / Style Recreation:** When attaching an image and asking to *"create a similar image"*, `minicpm-v` extracts the composition and styling directly into clean English SD tags, feeding ComfyUI (`Realistic_Vision`) to reproduce the design without conversational leaks.

---

## Русский

> ### ⚠️ ВНИМАНИЕ: ПРОЕКТ НАХОДИТСЯ В СТАДИИ РАЗРАБОТКИ
> **Примечание:** Проект находится в стадии активной разработки и тестирования (WIP). Интерфейс, логика работы агентов и структура API могут активно изменяться и дополняться.

### Описание проекта
Local AI Studio — это локальная среда разработки и генерации, объединяющая возможности локальных языковых моделей (LLM через Ollama) и генерации изображений (ComfyUI). Платформа предоставляет интерфейс для кодогенерации, навигации по проектам, ревизии версий файлов и создания графических ассетов прямо в проекте без передачи данных во внешние облака.

### Архитектура и функционал
- **Полная контейнеризация:** Связка контейнеров FastAPI (backend), React/Vite (frontend) и MongoDB (mongo) под управлением Docker Compose.
- **Встроенный веб-терминал:** Интерактивная консоль в нижней панели на базе `xterm.js` и WebSocket PTY с автоматической сменой рабочей директории под активный проект (`projects/<проект>`) и предустановленным Git.
- **Генерация шаблонов проектов через чат:** Мгновенная инициализация типовых проектов прямо из переписки с ассистентом или создание папок вручную в дереве проектов.
- **Агентное редактирование кода:** Чат-ассистент, способный анализировать контекст файлов, вносить изменения и фиксировать снимки истории (Revision History) с возможностью быстрого отката.
- **Генерация визуальных ассетов:** Встроенный интерфейс генерации картинок через ComfyUI с автоматическим сохранением графики в выбранную папку активного проекта.
- **Гибкое управление путями:** Путь к локальным проектам меняется строго через `.env` без правок в коде приложения.
- **Двухуровневая защита контекста:** Разделение хранилища и инференса. MongoDB хранит 100% истории переписки и вложений, тогда как в контекстное окно Ollama передается динамическое скользящее окно с изоляцией тяжелых Base64-строк и расширенным лимитом токенов (`num_ctx: 16384`), предотвращая сбои переполнения памяти.

---


---

### Создание проектов через чат и файловое дерево
Инициализировать новые проекты можно с помощью естественных команд в общем чате (на русском или английском языках), а также вручную кнопкой **«New Project»** в панели дерева файлов:

- **Статичный веб-проект (Static):**
  - *Команды в чате:* `создай статичный проект <имя>`, `create static project <name>`
  - *Создаваемая структура файлов:*
    - `index.html` (базовая семантическая разметка с подключением стилей и скриптов)
    - `images/` (каталог для графики и ассетов)
    - `css/style.css` (базовые стили и оформление темной темы)
    - `js/script.js` (обработчик готовности DOM)
- **Docker-проект (Nginx Web):**
  - *Команды в чате:* `создай докер проект <имя>`, `create docker project <name>`
  - *Создаваемая структура файлов:*
    - `app/index.html` (стартовая веб-страница сервиса)
    - `docker-compose.yml` (контейнер `nginx:alpine`, маппинг порта `8080:80` и монтирование тома `./app`)
- **Python-проект (Python):**
  - *Команды в чате:* `создай пайтон проект <имя>`, `create python project <name>`
  - *Создаваемая структура файлов:*
    - `main.py` (точка входа с функцией `main()`)
    - `requirements.txt` (стандартный набор библиотек: `requests`, `pydantic`, `python-dotenv`)

Все шаблоны и файлы генерируются строго на английском языке, а переписка и контекст агента подтягиваются автоматически.

---

### Интерактивный терминал (PTY)
В нижней части рабочего пространства доступен полнофункциональный терминал:
- **xterm.js и WebSocket:** Поддержка ANSI-цветов, копирования/вставки, автоподстройки размеров и прямого PTY-канала.
- **Синхронизация рабочей папки:** При переключении проектов терминал автоматически открывает сессию в `projects/<название-проекта>`.
- **Встроенные утилиты:** Внутри контейнера доступен `git` для коммитов и работы с ветками непосредственно из веб-интерфейса.

### Требования и интеграции

#### 1. Установка и настройка Ollama
Ollama запускается на локальной машине:
- **Основная модель для кода и агента:** `qwen2.5-coder:7b` (или `deepseek-coder`).
- **Модели для перевода (2 встроенные модели):** Для корректного составления промптов в ComfyUI используется двухэтапная цепочка перевода: модели переводят и адаптируют запросы с русского языка на специализированный английский синтаксис промптов.

Команды для скачивания моделей:
```bash
ollama pull qwen2.5-coder:7b
ollama pull llama3.2:latest
```

#### 2. Настройка ComfyUI
ComfyUI должен быть запущен с открытым сетевым доступом (`--listen 0.0.0.0`):
- **Необходимые Custom Nodes:**
  - ComfyUI-Manager
  - Ноды для работы с WebSocket API (ComfyUI-Custom-Scripts и вспомогательные пайплайны).
- **Модели и чекпоинты:**
  - Базовые модели генерации (`sd_xl_base_1.0.safetensors`, `v1-5-pruned-emaonly.safetensors` или Flux) в папке `ComfyUI/models/checkpoints/`.

---

### Развертывание и запуск

1. **Клонирование репозитория:**
```bash
git clone <repo-url> local-ai-studio
cd local-ai-studio
```

2. **Настройка файла переменных (.env):**
```bash
cp .env.example .env
```
Основные переменные:
```env
# Папка на вашем диске, в которой лежат проекты:
PROJECTS_DIR=./projects

# Сетевые порты сервисов:
BACKEND_PORT=8000
FRONTEND_PORT=3000
MONGO_PORT=27017

# Адреса внешних локальных сервисов:
OLLAMA_URL=http://host.docker.internal:11434
COMFY_URL=http://host.docker.internal:8188
MONGO_URI=mongodb://mongo:27017/local_ai_studio

# Настраиваемые модели (LLM, Vision, переводчик)
DEFAULT_CODER_MODEL=qwen2.5-coder:7b-instruct-q4_K_M
TRANSLATOR_MODEL=dolphin-llama3:latest
VISION_MODEL=minicpm-v:latest
```

3. **Запуск контейнеров:**
```bash
docker compose up -d
```
Интерфейс доступен по адресу `http://localhost:3000`.

### Работа с изображениями и мультимодальный чат
В студии реализован гибридный мультимодальный пайплайн, разделяющий визуальный анализ и синтез изображений:
- **Визуальный анализ (`minicpm-v`):** При прикреплении картинок или скриншотов с вопросами (*«что на картинке?»*, *«разбери UI макет»*) подключается `minicpm-v`. Бэкенд очищает Base64 от data-URI префиксов и возвращает подробный технический разбор элементов интерфейса, текста и палитры на русском языке.
- **Генерация изображений с нуля (Text-to-Image через ComfyUI + `dolphin-llama3`):** Команды вроде *«нарисуй кота»* или *«создай изображение киберпанк города»* маршрутизируются в ComfyUI. Запрос пользователя переводится и обогащается моделью `dolphin-llama3` в детализированный набор английских тегов для Stable Diffusion.
- **Воссоздание стиля и макетов (Image Recreation):** Если прикрепить изображение с просьбой *«создай такую же картинку»*, `minicpm-v` считывает композицию, структуру и тему, формируя чистый английский промпт для ComfyUI (чекпоинт `Realistic_Vision`) для генерации похожего дизайна.
