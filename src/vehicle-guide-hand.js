export function getVehicleGuideHandIssue(guide, levelKey, vehicles = []) {
  if (Number(guide?.enabled) !== 1) return null;
  const targetLevel = String(guide.levelKey ?? '').trim();
  if (!levelKey || targetLevel !== levelKey) {
    return {
      path: 'vehicleGuideHand.levelKey',
      message: targetLevel && levelKey
        ? `小手提示的引导关卡是 ${targetLevel}，请选择当前关卡 ${levelKey}。`
        : '请为小手提示选择当前关卡。'
    };
  }
  const targetId = Number(guide.vehicleId);
  if (!Number.isInteger(targetId) || targetId < 1 || !vehicles.some(vehicle => Number(vehicle?.id) === targetId)) {
    return {
      path: 'vehicleGuideHand.vehicleId',
      message: Number.isInteger(targetId) && targetId > 0
        ? `小手提示的目标车 ${targetId} 不在本关，请重新选择。`
        : '请为小手提示选择本关的目标车。'
    };
  }
  return null;
}

export function resetInheritedGuideHandDefault(tuning, levelKey) {
  const hand = tuning?.vehicleGuideHand;
  if (!levelKey || levelKey === 'level36' || hand?.levelKey !== 'level36'
    || Number(hand.enabled) !== 1 || Number(hand.vehicleId) !== 1
    || Number(hand.showAtStart) !== 1 || Number(hand.idleDelaySeconds) !== 5) return false;
  hand.enabled = 0;
  return true;
}
