import pytest
from services.intent_router import classify_intent, IntentType

def test_intent_1_chat_qa_bilingual():
    prompts = [
        # RU
        "что это за проект?",
        "как запустить этот скрипт?",
        "поясни архитектуру приложения",
        "какие зависимости используются?",
        # EN
        "what is this project about?",
        "how do I run this server?",
        "explain the application architecture",
        "what dependencies are installed?"
    ]
    for p in prompts:
        res = classify_intent(p, has_images=False, is_agent_mode=True)
        assert res["intent"] == IntentType.CHAT_QA, f"Failed on: {p}"

def test_intent_2_file_ops_bilingual():
    cases = [
        # RU
        ("создай contact.html с формой обратной связи", "contact.html"),
        ("добавь в main.py функцию логгера", "main.py"),
        ("отредактируй index.html: добавь кнопку", "index.html"),
        ("создай каркас нового лендинга с css и js", None),
        # EN
        ("create file contact.html with a feedback form", "contact.html"),
        ("add a logger function to main.py", "main.py"),
        ("edit index.html to add a submit button", "index.html"),
        ("scaffold a new landing page with css and js", None)
    ]
    for prompt, expected_file in cases:
        res = classify_intent(prompt, has_images=False, is_agent_mode=True)
        assert res["intent"] == IntentType.FILE_OPS, f"Failed on: {prompt}"
        if expected_file:
            assert res["target_file"] == expected_file

def test_intent_3_image_gen_bilingual():
    prompts = [
        # RU
        "нарисуй кота в стиле киберпанк",
        "сгенерируй фото современного офиса",
        "сделай арт космического корабля",
        # EN
        "draw a futuristic spaceship in space",
        "generate a photo of a modern office",
        "create artwork of a neon city at night"
    ]
    for p in prompts:
        res = classify_intent(p, has_images=False, is_agent_mode=True)
        assert res["intent"] == IntentType.IMAGE_GEN, f"Failed on: {p}"
        assert res.get("image_prompt") is not None

def test_intent_4_vision_qa_bilingual():
    prompts = [
        # RU
        "что изображено на этом скриншоте?",
        "разбери ошибки на картинке",
        "какие цвета и шрифты здесь использованы?",
        # EN
        "what is shown on this screenshot?",
        "explain the UI elements in this picture",
        "inspect the layout and typography here"
    ]
    for p in prompts:
        res = classify_intent(p, has_images=True, is_agent_mode=True)
        assert res["intent"] == IntentType.VISION_QA, f"Failed on: {p}"

def test_intent_5_image_to_image_bilingual():
    prompts = [
        # RU
        "создай такую же картинку",
        "нарисуй похожую иллюстрацию",
        "сделай изображение в таком же стиле",
        # EN
        "create a similar image",
        "draw an illustration like this one",
        "make similar artwork but in dark style"
    ]
    for p in prompts:
        res = classify_intent(p, has_images=True, is_agent_mode=True)
        assert res["intent"] == IntentType.IMAGE_TO_IMAGE, f"Failed on: {p}"


def test_global_chat_disallows_file_ops():
    # Проверяем, что команды файлов определяются как file_ops,
    # что позволит chat.py показать подсказку о переходе в Agent
    file_prompts = [
        "создай файл test.py с кодом",
        "create file index.html with header",
        "напиши файл config.json"
    ]
    for p in file_prompts:
        res = classify_intent(p, has_images=False, is_agent_mode=False)
        assert res["intent"] == IntentType.FILE_OPS, f"Failed to detect file op in chat: {p}"

def test_global_chat_scaffold_project():
    scaffold_prompts = [
        "создай проект my-landing",
        "create docker project backend_app",
        "создай python проект ml_agent"
    ]
    for p in scaffold_prompts:
        res = classify_intent(p, has_images=False, is_agent_mode=False)
        assert res["intent"] == IntentType.PROJECT_SCAFFOLD, f"Failed scaffold: {p}"
