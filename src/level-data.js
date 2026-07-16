import { ACTIVE_LEVEL } from './generated-active-level.js';

export const COLORS = Object.freeze({
  0: { name: 'Blue', hex: 0x0061e8, css: '#0061e8' },
  1: { name: 'Green', hex: 0x118024, css: '#118024' },
  2: { name: 'Pink', hex: 0xf338af, css: '#f338af' },
  3: { name: 'Purple', hex: 0x9725cd, css: '#9725cd' },
  4: { name: 'Red', hex: 0xb10f11, css: '#b10f11' },
  5: { name: 'Yellow', hex: 0xc68000, css: '#c68000' },
  6: { name: 'Orange', hex: 0xc24300, css: '#c24300' },
  7: { name: 'LightBlue', hex: 0x014853, css: '#014853' },
  8: { name: 'Brown', hex: 0x542c16, css: '#542c16' },
  9: { name: 'DarkGreen', hex: 0x206d53, css: '#206d53' },
  10: { name: 'DarkBlue', hex: 0x15209e, css: '#15209e' }
});

export const PASSENGER_COUNT_BOARD_COLORS = Object.freeze({
  0: { background: 0x50a7ff, outline: '#263767' },
  1: { background: 0x55cf63, outline: '#11601b' },
  2: { background: 0xff84fd, outline: '#ae276c' },
  3: { background: 0xc95aff, outline: '#5a3681' },
  4: { background: 0xf4585a, outline: '#7c2120' },
  5: { background: 0xffca13, outline: '#713908' },
  6: { background: 0xff9229, outline: '#963a0f' },
  7: { background: 0x4deaf6, outline: '#1f6d5c' },
  8: { background: 0xb46551, outline: '#702a09' },
  9: { background: 0x35ac93, outline: '#226355' },
  10: { background: 0x3e45ff, outline: '#161b6f' }
});

export let LEVEL_1 = ACTIVE_LEVEL;

export function setActiveLevel(level) {
  if (!level?.vehicles || !level?.passengerQueues) {
    throw new TypeError('Active level must include vehicles and passengerQueues.');
  }
  LEVEL_1 = level;
  return LEVEL_1;
}
