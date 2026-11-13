#!/bin/sh
set -eu

PORT="${1:-5173}"
# The deploy platform identifies a service by its container name, so this has
# to match the project name it was registered under.
PROJECT_NAME="bus-loop-playable-editor-wxj"
IMAGE_NAME="bus-loop-playable-editor-wxj"
# The platform only allows host volumes under /data/<project-name>, so the data
# root had to move off the older /data/bus-loop-playable-editor path. That old
# directory holds the live authored levels, so it is migrated once below before
# anything can seed an empty volume over it.
DATA_ROOT="/data/bus-loop-playable-editor-wxj"
LEGACY_DATA_ROOT="/data/bus-loop-playable-editor"
ARTIFACTS_DIR="${DATA_ROOT}/artifacts"
SEED_MARKER="${DATA_ROOT}/.seeded-v1"

docker tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:rollback" 2>/dev/null || true
docker build -t "${IMAGE_NAME}:latest" .

mkdir -p "${ARTIFACTS_DIR}"

# One-time migration off the legacy data root. Without this the fresh directory
# has no marker, the seeding block below runs, and the image's bundled levels
# overwrite the ~117 authored levels that live on the server. A failed copy
# aborts the deploy (`set -e`) instead of quietly reseeding.
if [ ! -f "${SEED_MARKER}" ] && [ -d "${LEGACY_DATA_ROOT}/artifacts" ]; then
  LEGACY_ENTRIES="$(ls -A "${LEGACY_DATA_ROOT}/artifacts" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${LEGACY_ENTRIES}" != "0" ]; then
    echo "Migrating authored data from ${LEGACY_DATA_ROOT} (${LEGACY_ENTRIES} entries)..."
    cp -a "${LEGACY_DATA_ROOT}/artifacts/." "${ARTIFACTS_DIR}/"
    touch "${SEED_MARKER}"
    echo "Migration complete."
  fi
fi

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
