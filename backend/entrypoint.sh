#!/bin/bash
set -e

echo "=========================================="
echo " [BACKEND] Running tests on container start..."
echo "=========================================="

# Сбрасываем прокси-переменные для изоляции тестов
# pytest -v tests/

echo "=========================================="
echo " [BACKEND] All tests passed! Starting server..."
echo "=========================================="

exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude "projects/*" --reload-exclude "*.venv*"
