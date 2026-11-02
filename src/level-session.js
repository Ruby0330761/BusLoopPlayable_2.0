// A session is an ordered play list plus, optionally, one choice gate.
//
// The ordinary flow is a fixed sequence: win stage N, move to stage N+1. A
// choice gate is different: the stage has no fixed successor, so the win parks
// the session on a pending decision and only a pick (or the reset path) moves
// it forward. Keeping that in the pure model means main.js never has to know
// whether a win ends the ad, advances, or asks the player to choose.
export function createLevelSession(levels, { choices = [] } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('Playable level session requires at least one level.');
  }

  const fixedLevelCount = levels.length;
  const playOrder = levels.slice();
  let levelIndex = 0;
  let successfulOperationCount = 0;
  let installReady = false;
  // Set by the first win on a stage that declares a choice; cleared by choose().
  let pendingChoice = null;
  const countedVehicles = new Set();

  const currentLevel = () => playOrder[levelIndex];
  const currentLevelKey = () => currentLevel()?.key ?? `level-${levelIndex}`;
  const optionsForStage = (index) => {
    const stageChoices = choices[index];
    return Array.isArray(stageChoices) && stageChoices.length > 0 ? stageChoices : null;
  };
  // A pending choice is not final: the ad still owns the player, so the store
  // gate must stay shut until the picked stage is actually finished.
  const isFinalLevel = () => !pendingChoice && levelIndex >= playOrder.length - 1;

  return {
    currentLevel,
    levelCount: () => playOrder.length,
    pendingChoice: () => pendingChoice,
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
      if (levelIndex + 1 < playOrder.length) {
        levelIndex += 1;
        return currentLevel();
      }
      if (pendingChoice) return null;
      // Declaring the options is the only thing a win does here; the level is
      // appended by choose(), so a lost pick can never leave a half-filled slot.
      const options = optionsForStage(levelIndex);
      if (options) {
        pendingChoice = options;
        return null;
      }
      return null;
    },
    choose(optionId) {
      if (!pendingChoice) return null;
      const wanted = String(optionId ?? '').trim();
      const option = pendingChoice.find((entry) => (
        String(entry.id) === wanted || String(entry.levelKey) === wanted
      ));
      if (!option?.level) return null;
      pendingChoice = null;
      playOrder.push(option.level);
      levelIndex = playOrder.length - 1;
      return currentLevel();
    },
    shouldOpenStore() {
      return installReady && isFinalLevel();
    },
    reset() {
      levelIndex = 0;
      successfulOperationCount = 0;
      installReady = false;
      pendingChoice = null;
      playOrder.length = fixedLevelCount;
      countedVehicles.clear();
      return currentLevel();
    },
    state() {
      return {
        levelIndex,
        levelKey: currentLevelKey(),
        successfulOperationCount,
        installReady,
        levelCount: playOrder.length,
        choicePending: Boolean(pendingChoice)
      };
    }
  };
}
