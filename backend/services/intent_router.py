import re
from enum import Enum
from typing import Optional, List, Dict, Any

class IntentType(str, Enum):
    CHAT_QA = "chat_qa"                  # 1. Свободное общение / вопросы
    FILE_OPS = "file_ops"                # 2. Создание или редактирование файлов (только Agent)
    IMAGE_GEN = "image_gen"              # 3. Генерация в ComfyUI
    VISION_QA = "vision_qa"              # 4. Анализ изображения через Vision LLM
    IMAGE_TO_IMAGE = "image_to_image"    # 5. Генерация аналога по образцу в ComfyUI
    PROJECT_SCAFFOLD = "project_scaffold" # 6. Создание нового проекта с нуля (Chat -> Agent)

IMAGE_INTENT_PATTERNS = [
    r"(?:наполни|добавь|создай|сгенерируй|нарисуй|отрисуй|сделай)\s+(?:мне\s+)?(?:картинк|фото|изображен|арт|иллюстраци)[а-яa-z0-9_\s]*?(?:про|с|на\s+тему|:)?\s*(.*)",
    r"(?:generate|create|draw|paint|render|make)\s+(?:an?\s+)?(?:image|picture|photo|asset|render|artwork|illustration)[a-z0-9_\s]*?(?:of|for|about|:)?\s*(.*)",
    r"^(?:нарисуй|отрисуй|сделай арт|изобрази|draw|sketch|paint|render)\s+(.*)",
    r"(?:сгенерируй|создай|generate|create).*?\.(?:png|jpg|jpeg|webp)"
]

FILE_ACTION_TRIGGERS = [
    "создай файл", "добавь файл", "напиши файл", "сделай файл", "создай страницу",
    "измени файл", "исправь файл", "перепиши файл", "обнови файл", "отредактируй",
    "создай каркас", "каркас",
    "create file", "write file", "add file", "make file", "generate file",
    "edit file", "modify file", "update file", "patch file", "refactor",
    "scaffold"
]

QA_TRIGGERS = [
    "что это", "что за", "какой", "какая", "какие", "как запустить", "как работает", 
    "расскажи", "поясни", "объясни", "почему", "зачем", "покажи", "список файлов", 
    "где находится", "в чем разница", "опиши", "структура", "архитектур",
    "what is", "what does", "how to", "how do", "how does", "why", "where is",
    "explain", "describe", "tell me", "show me", "list files", "project overview",
    "what project", "about this project"
]

QA_STOP_WORDS = [
    "что", "как", "опиши", "поясни", "расскажи", "почему", "разбери", "посмотри", "где",
    "what", "how", "describe", "explain", "why", "where", "inspect", "review"
]

def extract_custom_image_path(prompt: str) -> Optional[str]:
    patterns = [
        r"(?:в\s+папку|в\s+папке|в\s+директорию|path:|folder:|save\s+to|put\s+in)\s+([a-zA-Z0-9_\-/\.]+)",
        r"(?:сохрани(?:ть)?\s+в|положи\s+в)\s+([a-zA-Z0-9_\-/\.]+)",
    ]
    for p in patterns:
        m = re.search(p, prompt, re.IGNORECASE)
        if m:
            clean_path = m.group(1).strip(" \t\r\n'\"/\\")
            if clean_path and ".." not in clean_path:
                return clean_path
    return None

def detect_image_generation_prompt(text: str) -> Optional[str]:
    raw = text.strip()
    words = re.findall(r"\b\w+\b", raw.lower())
    if any(w in QA_STOP_WORDS for w in words[:3]):
        return None

    for p in IMAGE_INTENT_PATTERNS:
        m = re.search(p, raw, re.IGNORECASE)
        if m:
            groups = m.groups()
            desc = groups[0].strip() if groups and groups[0] else raw
            desc = re.sub(r"(?:и\s+|and\s+)?(?:сохрани|положи|save|put|store).*$", "", desc, flags=re.IGNORECASE).strip()
            return desc if len(desc) > 3 else raw
    return None

def parse_project_creation_intent(text: str) -> Optional[Dict[str, str]]:
    raw = text.strip()
    lower = raw.lower()

    # Вопросы никогда не являются созданием проекта
    if any(q in lower for q in QA_TRIGGERS) or lower.endswith("?"):
        return None

    words = re.findall(r"\b\w+\b", lower)
    if any(w in QA_STOP_WORDS for w in words[:3]):
        return None

    # Должен быть глагол действия создания
    action_words = ["создай", "создать", "сделай", "create", "new", "init", "start"]
    if not any(w in lower for w in action_words):
        return None

    has_project_kw = any(w in lower for w in ["проект", "project"])
    has_type_kw = any(w in lower for w in ["докер", "docker", "пайтон", "python", "питон", "статич", "static", "лендинг", "landing"])
    
    if not (has_project_kw or has_type_kw):
        return None

    # Исключаем создание файлов
    if any(k in lower for k in ["файл", "file", "страницу", "page", ".html", ".py", ".js", ".css"]):
        return None

    ptype = "static"
    if any(k in lower for k in ["докер", "docker"]):
        ptype = "docker"
    elif any(k in lower for k in ["пайтон", "python", "питон"]):
        ptype = "python"
    elif any(k in lower for k in ["статич", "static", "лендинг", "landing", "веб", "web"]):
        ptype = "static"

    match = re.search(r"(?:проект|project)\s+([a-zA-Z0-9_\-]+)", raw, re.IGNORECASE)
    if match:
        proj_name = match.group(1).strip()
        stop_words = {"new", "новый", "статичный", "docker", "python", "static", "landing", "a", "an", "the"}
        if proj_name.lower() not in stop_words:
            return {"name": proj_name, "project_type": ptype}

    match2 = re.search(r"(?:создай|создать|сделай|create|new)\s+(?:статичный|статический|докер|docker|пайтон|python|питон|лендинг|landing)?\s*(?:проект|project)?\s*([a-zA-Z0-9_\-]+)", raw, re.IGNORECASE)
    if match2:
        candidate = match2.group(1).strip()
        stop_words = {
            "статичный", "статический", "докер", "docker", "пайтон", "python", "питон",
            "проект", "project", "landing", "лендинг", "файл", "file", "страница", "page",
            "new", "artwork", "image", "picture", "photo"
        }
        if candidate.lower() not in stop_words:
            return {"name": candidate, "project_type": ptype}

    return None

def extract_target_files(prompt: str, active_file_path: Optional[str] = None) -> List[str]:
    raw_lower = prompt.lower()
    prompt_files = re.findall(r"[a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+", prompt)
    clean_files = []
    for cf in prompt_files:
        c = cf.strip("`'\".,;:()[]{}<> \t\n")
        if c and not c.endswith((".com", ".org", ".net", ".ru", ".io")):
            clean_files.append(c)
    clean_files = list(dict.fromkeys(clean_files))

    if not clean_files and active_file_path:
        context_triggers = [
            "этот файл", "текущий файл", "измени его", "в этот файл",
            "this file", "current file", "modify it", "update it"
        ]
        if any(k in raw_lower for k in context_triggers):
            clean_files.append(active_file_path)

    return clean_files

def classify_intent(
    prompt: str,
    has_images: bool = False,
    active_file_path: Optional[str] = None,
    is_agent_mode: bool = True
) -> Dict[str, Any]:
    raw = prompt.strip()
    raw_lower = raw.lower()

    # 1. Прикрепленные изображения (Vision / Image-to-Image)
    if has_images:
        recreation_triggers = [
            "такую же", "такое же", "такой же", "похожую", "подобную", 
            "в таком же стиле", "в этом же стиле", "перерисуй", "сделай такую",
            "make similar", "recreate", "like this", "same style", "draw similar", "similar image"
        ]
        if any(w in raw_lower for w in recreation_triggers):
            return {
                "intent": IntentType.IMAGE_TO_IMAGE,
                "target_file": None,
                "image_prompt": raw
            }
        return {
            "intent": IntentType.VISION_QA,
            "target_file": None,
            "image_prompt": None
        }

    # 2. Прямая генерация графики через ComfyUI
    img_desc = detect_image_generation_prompt(raw)
    if img_desc:
        return {
            "intent": IntentType.IMAGE_GEN,
            "target_file": None,
            "image_prompt": img_desc,
            "custom_path": extract_custom_image_path(raw)
        }

    # 3. Чистые вопросы и аналитика (проверяем ДО создания проектов и файлов)
    is_explicit_qa = any(q in raw_lower for q in QA_TRIGGERS) or raw.endswith("?")
    has_file_triggers = any(t in raw_lower for t in FILE_ACTION_TRIGGERS)
    files = extract_target_files(prompt, active_file_path)
    target_file = files[0] if len(files) == 1 else None

    if is_explicit_qa and not has_file_triggers:
        return {
            "intent": IntentType.CHAT_QA,
            "target_file": None,
            "target_files": []
        }

    # 4. Создание проекта с нуля (только в режиме Global Chat)
    if not is_agent_mode:
        scaffold_info = parse_project_creation_intent(raw)
        if scaffold_info:
            return {
                "intent": IntentType.PROJECT_SCAFFOLD,
                "project_name": scaffold_info["name"],
                "project_type": scaffold_info["project_type"]
            }

    # 5. Операции с файлами и структурой (FILE_OPS)
    if target_file or has_file_triggers:
        return {
            "intent": IntentType.FILE_OPS,
            "target_file": target_file,
            "target_files": files,
            "is_multi_file": len(files) > 1 or any(k in raw_lower for k in ["каркас", "scaffold", "архитектур"])
        }

    # 6. Базовый сценарий: текстовое общение
    return {
        "intent": IntentType.CHAT_QA,
        "target_file": None,
        "target_files": []
    }
