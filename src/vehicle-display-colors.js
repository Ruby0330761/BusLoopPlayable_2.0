// Display colours as the playable actually renders them.
//
// The authoring palette (`VEHICLE_COLOR_OPTIONS`) stores each atlas's raw body
// paint value. That value is *not* what a player sees: the runtime renders the
// atlas through a MeshStandardMaterial lit by one hemisphere plus one
// directional light, so a deeply saturated base like the teal atlas (#014853)
// shows up as a bright cyan (#23eeff) on screen. The authoring canvas drew the
// raw base, which made an editor board read much darker than the same board in
// the playable — the same colour looked like two different colours.
//
// Values below are measured from the real playable renderer: each car was built
// from the shipped vehicle material for that atlas slot, lit by the scene's own
// lights, and sampled through the playable camera. They are stable across the
// board (a car at the top row and one at the bottom row agree), so one table is
// enough.
//
// `resolveColorAtlasPaths`/`COLORS` stay untouched: the atlas index → texture
// mapping and any recolour maths still need the raw paint values. Only the
// editor's presentation reads this table.
export const VEHICLE_RENDERED_COLOR_CSS = Object.freeze({
  0: '#4EA4FF', // blue
  1: '#33F145', // green
  2: '#FF5AC9', // pink
  3: '#B53DFF', // purple
  4: '#FF3B3C', // red
  5: '#FFD31C', // yellow
  6: '#FF7B1C', // orange
  7: '#23EEFF', // lightblue (atlas base is near-black teal)
  8: '#9C4D3B', // brown
  9: '#34B194', // darkgreen
  10: '#343AFF', // darkblue
  // 11-16 are special mechanism vehicles: police, firetruck, ambulance, VIP,
  // luxury and the Christmas sled carry authored models/textures rather than a
  // paint atlas, so their swatches stay authoring placeholders.
  11: '#1B2638',
  12: '#B10F11',
  13: '#FFFFFF',
  14: '#FFD8C8',
  15: '#D7B477',
  16: '#C62828',
  17: '#333333', // black
  // The white atlas is an almost-white body under strong light: the modal pixel
  // clips to pure white, so the swatch keeps a hint of shading to stay legible
  // against the editor's light canvas.
  18: '#F5F5F4', // white
  19: '#DE3A3B', // darkred
  20: '#FFDA24', // darkyellow
  21: '#FFFFE3', // cream
  22: '#8AFFF1', // mintgreen
  23: '#D6FFBD', // matchagreen
  24: '#FFBEEA', // lightpink
  25: '#C6C9CD' // gray
});

const FALLBACK_RENDERED_COLOR = '#8A94A3';

/**
 * The colour a vehicle of this atlas slot shows in the playable.
 *
 * Falls back to the authoring palette's raw value only when the slot has no
 * measured entry, so an unknown colour still renders as something visible.
 */
export function renderedVehicleColorCss(colorIndex, fallbackCss = FALLBACK_RENDERED_COLOR) {
  const value = VEHICLE_RENDERED_COLOR_CSS[Number(colorIndex)];
  return typeof value === 'string' ? value : fallbackCss;
}

/** Same lookup, returning a lowercase hex string for CSS/canvas consumers. */
export function renderedVehicleColor(colorIndex, fallbackCss = FALLBACK_RENDERED_COLOR) {
  return renderedVehicleColorCss(colorIndex, fallbackCss).toLowerCase();
}
