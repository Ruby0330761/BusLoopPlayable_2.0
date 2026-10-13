#!/bin/sh
set -eu

PORT="${1:-5173}"
PROJECT_NAME="bus-loop-playable-editor"
IMAGE_NAME="bus-loop-playable-editor"
DATA_ROOT="/data/${PROJECT_NAME}"
ARTIFACTS_DIR="${DATA_ROOT}/artifacts"
SEED_MARKER="${DATA_ROOT}/.seeded-v1"

docker tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:rollback" 2>/dev/null || true
docker build -t "${IMAGE_NAME}:latest" .

mkdir -p "${ARTIFACTS_DIR}"
if [ ! -f "${SEED_MARKER}" ]; then
  SEED_CONTAINER="${PROJECT_NAME}-seed-$$"
  docker create --name "${SEED_CONTAINER}" "${IMAGE_NAME}:latest" >/dev/null
  docker cp "${SEED_CONTAINER}:/app/artifacts/." "${ARTIFACTS_DIR}/"
  docker rm "${SEED_CONTAINER}" >/dev/null
  touch "${SEED_MARKER}"
fi

docker stop "${PROJECT_NAME}" >/dev/null 2>&1 || true
docker rm "${PROJECT_NAME}" >/dev/null 2>&1 || true
CONTAINER_ID="$(docker run -d \
  --name "${PROJECT_NAME}" \
  --restart unless-stopped \
  --memory 2g \
  --memory-swap 2g \
  --cpus 1 \
  -p "${PORT}:5173" \
  -v "${ARTIFACTS_DIR}:/app/artifacts" \
  "${IMAGE_NAME}:latest")"

ATTEMPT=0
while [ "${ATTEMPT}" -lt 10 ]; do
  sleep 1
  if [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_ID}" 2>/dev/null || true)" != "true" ]; then
    echo "Container exited during startup. State:"
    docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}' "${CONTAINER_ID}" 2>&1 || true
    echo "Recent logs:"
    docker logs --tail 200 "${CONTAINER_ID}" 2>&1 || true
    exit 1
  fi
  ATTEMPT=$((ATTEMPT + 1))
done

if ! docker exec "${CONTAINER_ID}" node -e "fetch('http://127.0.0.1:5173/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
  echo "Container stayed running but did not pass its HTTP startup check."
  docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}' "${CONTAINER_ID}" 2>&1 || true
  docker logs --tail 200 "${CONTAINER_ID}" 2>&1 || true
  exit 1
fi

echo "Container ${CONTAINER_ID} is running on port ${PORT}."
