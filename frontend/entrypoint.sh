#!/bin/sh
set -e

echo "=========================================="
echo " [FRONTEND] Running tests on container start..."
echo "=========================================="

npm test

echo "=========================================="
echo " [FRONTEND] All tests passed! Starting Vite..."
echo "=========================================="

# Увеличиваем допустимый размер HTTP заголовков до 64KB
export NODE_OPTIONS="--max-http-header-size=65536"
exec npm run dev
