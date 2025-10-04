#!/bin/bash

echo "=== Bank Reconciliation Application Setup Test ==="
echo

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    exit 1
fi

echo "✅ Docker is available"

# Check if docker compose is available (newer syntax)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "❌ Docker Compose is not available"
    exit 1
fi

echo "✅ Docker Compose is available"

# Check if required files exist
required_files=(
    "docker-compose.yml"
    "backend/Dockerfile"
    "backend/package.json"
    "frontend/Dockerfile"
    "frontend/package.json"
    "ml-service/Dockerfile"
    "ml-service/requirements.txt"
)

echo
echo "Checking required files..."
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

echo
echo "=== Setup verification completed successfully! ==="
echo
echo "To start the application:"
echo "1. $DOCKER_COMPOSE_CMD build"
echo "2. $DOCKER_COMPOSE_CMD up -d"
echo "3. Open http://localhost:3000 in your browser"
echo
echo "To stop the application:"
echo "$DOCKER_COMPOSE_CMD down"