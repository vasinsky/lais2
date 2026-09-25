#!/bin/sh
set -e

echo "=========================================="
echo " [FRONTEND] Running tests on container start..."
echo "=========================================="

npm test

echo "=========================================="
echo " [FRONTEND] All tests passed! Starting Vite..."
echo "=========================================="

exec npm run dev
