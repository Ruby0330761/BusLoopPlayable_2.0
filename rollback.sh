#!/bin/sh
set -eu

PORT="${1:-5173}"
PROJECT_NAME="bus-loop-playable-editor"
IMAGE_NAME="bus-loop-playable-editor"
DATA_ROOT="/data/${PROJECT_NAME}"

if ! docker image inspect "${IMAGE_NAME}:rollback" >/dev/null 2>&1; then
  echo "No rollback image is available."
  exit 1
fi

docker stop "${PROJECT_NAME}" >/dev/null 2>&1 || true
docker rm "${PROJECT_NAME}" >/dev/null 2>&1 || true
CONTAINER_ID="$(docker run -d \
  --name "${PROJECT_NAME}" \
  --restart unless-stopped \
  -p "${PORT}:5173" \
  -v "${DATA_ROOT}/artifacts:/app/artifacts" \
  "${IMAGE_NAME}:rollback")"

sleep 3
if [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_ID}" 2>/dev/null || true)" != "true" ]; then
  echo "Rollback container exited during startup. Recent logs:"
  docker logs --tail 200 "${CONTAINER_ID}" 2>&1 || true
  exit 1
fi

echo "Rollback container ${CONTAINER_ID} is running on port ${PORT}."
