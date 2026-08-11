export function createLevelSession(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('Playable level session requires at least one level.');
  }

  let levelIndex = 0;
  let successfulOperationCount = 0;
  let installReady = false;
  const countedVehicles = new Set();

  const currentLevel = () => levels[levelIndex];
  const currentLevelKey = () => currentLevel()?.key ?? `level-${levelIndex}`;
  const isFinalLevel = () => levelIndex >= levels.length - 1;

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
    advanceAfterWin() {
      if (levelIndex + 1 >= levels.length) return null;
      levelIndex += 1;
      return currentLevel();
    },
    shouldOpenStore() {
      return installReady && isFinalLevel();
    },
    reset() {
      levelIndex = 0;
      successfulOperationCount = 0;
      installReady = false;
      countedVehicles.clear();
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
