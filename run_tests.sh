#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}==============================================${NC}"
echo -e "${BLUE}   RUNNING FULL STUDIO AI TEST SUITE        ${NC}"
echo -e "${BLUE}==============================================${NC}\n"

# 1. Запуск тестов бэкенда (pytest + studio_test DB)
echo -e "${YELLOW}[1/2] Running Backend Tests (pytest + studio_test DB)...${NC}"
if docker compose exec -T -e ALL_PROXY= -e all_proxy= -e HTTP_PROXY= -e http_proxy= -e HTTPS_PROXY= -e https_proxy= backend pytest -v tests/; then
    echo -e "${GREEN}✓ Backend tests passed successfully!${NC}\n"
else
    echo -e "${RED}✗ Backend tests failed!${NC}"
    exit 1
fi

# 2. Запуск тестов фронтенда (React + Vitest)
echo -e "${YELLOW}[2/2] Running Frontend Tests (Vitest + RTL)...${NC}"
if docker compose exec -T -e ALL_PROXY= -e all_proxy= -e HTTP_PROXY= -e http_proxy= -e HTTPS_PROXY= -e https_proxy= frontend npm test; then
    echo -e "${GREEN}✓ Frontend tests passed successfully!${NC}\n"
else
    echo -e "${RED}✗ Frontend tests failed!${NC}"
    exit 1
fi

echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN}   ALL TESTS PASSED! CI/CD READY ✓           ${NC}"
echo -e "${GREEN}==============================================${NC}"
