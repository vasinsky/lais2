#!/bin/bash
set -e

echo "=========================================="
echo " [BACKEND] Running tests on container start..."
echo "=========================================="

# Сбрасываем прокси-переменные для изоляции тестов
ALL_PROXY= all_proxy= HTTP_PROXY= http_proxy= HTTPS_PROXY= https_proxy= pytest -v tests/

echo "=========================================="
echo " [BACKEND] All tests passed! Starting server..."
echo "=========================================="

exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
