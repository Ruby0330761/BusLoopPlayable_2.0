export function shouldGameOverRetryOpenStore({
  vehicleExitGateEnabled = false,
  operationGateReady = false,
  vehicleExitGateReady = false
} = {}) {
  return !vehicleExitGateEnabled || operationGateReady || vehicleExitGateReady;
}

export function shouldBlockGameplayForStore({
  storeReady = false,
  storeRedirectTriggered = false,
  continueAfterStoreOpen = false
} = {}) {
  return storeReady && !(storeRedirectTriggered && continueAfterStoreOpen);
}

export function createLevelSession(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('Playable level session requires at least one level.');
  }

  let levelIndex = 0;
  let successfulOperationCount = 0;
  let installReady = false;
  const countedVehicles = new Set();
  const exitedVehicles = new Set();

  const currentLevel = () => levels[levelIndex];
  const currentLevelKey = () => currentLevel()?.key ?? `level-${levelIndex}`;
  const isFinalLevel = () => levelIndex >= levels.length - 1;
  const normalizeVehicleIds = (value) => {
    const values = Array.isArray(value)
      ? value
      : String(value ?? '').split(/[,，\s]+/u);
    return [...new Set(values
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry > 0))];
  };
  const isVehicleExitGateReady = (config = {}) => {
    const gateLevelKey = String(config.levelKey ?? '');
    if (!config.enabled || !gateLevelKey) return false;
    const vehicleIds = normalizeVehicleIds(config.vehicleIds);
    return vehicleIds.length > 0
      && vehicleIds.every((vehicleId) => exitedVehicles.has(`${gateLevelKey}:${vehicleId}`));
  };

  return {
    currentLevel,
    recordSuccessfulVehicle(vehicleId, threshold) {
      const key = `${currentLevelKey()}:${vehicleId}`;
      if (countedVehicles.has(key)) return false;
      countedVehicles.add(key);
      successfulOperationCount += 1;
      if (successfulOperationCount >= Math.max(1, Math.floor(Number(threshold) || 1))) {
        installReady = true;
      }
      return installReady && isFinalLevel();
    },
    hasCountedVehicle(vehicleId) {
      return countedVehicles.has(`${currentLevelKey()}:${vehicleId}`);
    },
    recordVehicleExit(vehicleId, config = {}) {
      const normalizedId = Number(vehicleId);
      const vehicleIds = normalizeVehicleIds(config.vehicleIds);
      if (
        !config.enabled
        || String(config.levelKey ?? '') !== currentLevelKey()
        || !vehicleIds.includes(normalizedId)
      ) {
        return false;
      }
      exitedVehicles.add(`${currentLevelKey()}:${normalizedId}`);
      return isVehicleExitGateReady(config);
    },
    isVehicleExitGateReady,
    advanceAfterWin() {
      if (levelIndex + 1 >= levels.length) return null;
      levelIndex += 1;
      return currentLevel();
    },
    shouldOpenStore() {
      return installReady && isFinalLevel();
    },
    restartCurrentLevel() {
      const levelPrefix = `${currentLevelKey()}:`;
      for (const key of countedVehicles) {
        if (key.startsWith(levelPrefix)) countedVehicles.delete(key);
      }
      return currentLevel();
    },
    reset() {
      levelIndex = 0;
      successfulOperationCount = 0;
      installReady = false;
      countedVehicles.clear();
      exitedVehicles.clear();
      return currentLevel();
    },
    state() {
      return {
        levelIndex,
        levelKey: currentLevelKey(),
        successfulOperationCount,
        installReady
      };
    }
  };
}
