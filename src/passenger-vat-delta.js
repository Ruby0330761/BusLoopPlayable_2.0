const signature = [86, 68, 49, 54]; // VD16

// Half-float bit patterns are treated as unsigned words throughout. Plane
// order is component, low/high byte, vertex, frame.
export function encodeVatDeltas(bytes, width, height) {
  const pixels = width * height;
  if (bytes.length !== pixels * 8) throw new Error('Unexpected VAT texture size.');
  const result = new Uint8Array(4 + bytes.length);
  result.set(signature);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let c = 0; c < 4; c++) {
    for (let x = 0; x < width; x++) {
      let previous = 0;
      for (let y = 0; y < height; y++) {
        const word = view.getUint16(((y * width + x) * 4 + c) * 2, true);
        const delta = (word - previous) & 0xffff;
        const i = 4 + c * 2 * pixels + x * height + y;
        result[i] = delta & 255;
        result[i + pixels] = delta >>> 8;
        previous = word;
      }
    }
  }
  return result;
}

export function decodeVatDeltas(bytes, width, height) {
  const pixels = width * height;
  if (bytes.length === pixels * 8) return bytes;
  if (bytes.length !== 4 + pixels * 8 || !signature.every((value, i) => bytes[i] === value)) {
    throw new Error('Unexpected VAT texture format.');
  }
  const output = new Uint8Array(pixels * 8);
  const view = new DataView(output.buffer);
  for (let c = 0; c < 4; c++) {
    for (let x = 0; x < width; x++) {
      let word = 0;
      for (let y = 0; y < height; y++) {
        const i = 4 + c * 2 * pixels + x * height + y;
        word = (word + bytes[i] + (bytes[i + pixels] << 8)) & 0xffff;
        view.setUint16(((y * width + x) * 4 + c) * 2, word, true);
      }
    }
  }
  return output;
}
