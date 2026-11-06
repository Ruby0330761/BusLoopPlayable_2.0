import { FOOTAGE10_LAYOUT } from './generated-footage10-layout.js';
import { FOOTAGE8_DEFAULT_TUNING, getFootage8DisplayMatrix, getFootage8Paths, getFootage8RuntimeConfig } from './footage8-conveyor.js';

export const FOOTAGE10_DEFAULT_TUNING = Object.freeze({
  ...FOOTAGE8_DEFAULT_TUNING, rowSpacing: 0.32, showLeftQueue: 0,
  boardingPositionPercent: (FOOTAGE10_LAYOUT.exitStart + FOOTAGE10_LAYOUT.exitEnd) * 50,
  boardingWidthPercent: (FOOTAGE10_LAYOUT.exitEnd - FOOTAGE10_LAYOUT.exitStart) * 100
});
export const getFootage10DisplayMatrix = (tuning) => getFootage8DisplayMatrix(tuning, FOOTAGE10_LAYOUT, FOOTAGE10_DEFAULT_TUNING);
export const getFootage10Paths = (tuning) => getFootage8Paths(tuning, FOOTAGE10_LAYOUT, FOOTAGE10_DEFAULT_TUNING);
export const getFootage10RuntimeConfig = (curve, tuning) => getFootage8RuntimeConfig(curve, tuning, FOOTAGE10_DEFAULT_TUNING);
