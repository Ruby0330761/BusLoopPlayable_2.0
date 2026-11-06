import { FOOTAGE9_LAYOUT } from './generated-footage9-layout.js';
import { FOOTAGE8_DEFAULT_TUNING, getFootage8DisplayMatrix, getFootage8Paths, getFootage8RuntimeConfig } from './footage8-conveyor.js';

// Presentation defaults are independent of Footage8's saved level settings.
export const FOOTAGE9_DEFAULT_TUNING = Object.freeze({
  ...FOOTAGE8_DEFAULT_TUNING, rowSpacing: 0.32,
  boardingPositionPercent: (FOOTAGE9_LAYOUT.exitStart + FOOTAGE9_LAYOUT.exitEnd) * 50,
  boardingWidthPercent: (FOOTAGE9_LAYOUT.exitEnd - FOOTAGE9_LAYOUT.exitStart) * 100
});
export const getFootage9DisplayMatrix = (tuning) => getFootage8DisplayMatrix(tuning, FOOTAGE9_LAYOUT, FOOTAGE9_DEFAULT_TUNING);
export const getFootage9Paths = (tuning) => getFootage8Paths(tuning, FOOTAGE9_LAYOUT, FOOTAGE9_DEFAULT_TUNING);
export const getFootage9RuntimeConfig = (curve, tuning) => getFootage8RuntimeConfig(curve, tuning, FOOTAGE9_DEFAULT_TUNING);
