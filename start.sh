#!/bin/sh
set -eu

PORT="${1:-5173}"
# The deploy platform identifies a service by its container name, so this has
# to match the project name it was registered under. The data directory stays
# on the original path on purpose: /data/bus-loop-playable-editor/artifacts
# holds the live authored levels, and pointing a fresh, empty volume at it
# would reseed from the image's 32 bundled levels and lose the other ~70.
PROJECT_NAME="bus-loop-playable-editor-wxj"
IMAGE_NAME="bus-loop-playable-editor-wxj"
DATA_ROOT="/data/bus-loop-playable-editor"
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
# Older releases of this editor were deployed as `bus-loop-playable-editor`
# and may still be holding the port after the service record was removed.
# Stop that leftover container too, or the new one cannot bind.
LEGACY_NAME="bus-loop-playable-editor"
if [ "${LEGACY_NAME}" != "${PROJECT_NAME}" ]; then
  docker stop "${LEGACY_NAME}" >/dev/null 2>&1 || true
  docker rm "${LEGACY_NAME}" >/dev/null 2>&1 || true
fi
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
