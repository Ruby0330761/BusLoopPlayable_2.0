const bitrateV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const bitrateV2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const sampleRates = [44100, 48000, 32000];
const isZero = value => value === 0;
const startsWith = (bytes, marker, offset = 0) => (
  bytes.subarray(offset, offset + marker.length).equals(Buffer.from(marker))
);

function syncSafeInt(bytes) {
  if (bytes.some(value => value >= 128)) return -1;
  return bytes.reduce((value, byte) => value * 128 + byte, 0);
}

function isProductionFrame(id, frame) {
  if (id === 'PRIV') {
    // The private owner field ends at the first NUL. Other owners may carry
    // gapless playback information (e.g. iTunSMPB).
    const packet = frame.toString('latin1');
    return packet.startsWith('XMP\0<?xpacket') && packet.includes('<?xpacket end=')
      && !/replay.?gain|itunsmpb|itunnorm|gapless|encoder.?delay|encoder.?padding/iu.test(packet);
  }
  const text = frame.subarray(1).toString('latin1');
  if (['TYER', 'TDAT', 'TIME'].includes(id)) {
    return frame[0] === 0 && /^[0-9]{4}\x00?$/u.test(text);
  }
  return id === 'TSSE' && (frame[0] === 0 || frame[0] === 3) && /^Lavf[0-9.]+\x00?$/u.test(text);
}

function readLeadingTag(bytes) {
  const [version, revision, flags] = bytes.subarray(3, 6);
  if (bytes.length < 10 || ![3, 4].includes(version) || revision !== 0 || flags !== 0) {
    return { reason: 'unsupported-id3v2-header' };
  }
  const bodyLength = syncSafeInt(bytes.subarray(6, 10));
  const end = 10 + bodyLength;
  if (bodyLength < 0 || end >= bytes.length) return { reason: 'invalid-id3v2-length' };
  let offset = 10;
  while (offset < end) {
    if (bytes[offset] === 0 && bytes.subarray(offset, end).every(isZero)) break;
    if (end - offset < 10) return { reason: 'invalid-id3v2-frame' };
    const id = bytes.toString('latin1', offset, offset + 4);
    const length = version === 3 ? bytes.readUInt32BE(offset + 4)
      : syncSafeInt(bytes.subarray(offset + 4, offset + 8));
    const frameStart = offset + 10;
    const nextOffset = frameStart + length;
    if (!/^[A-Z0-9]{4}$/u.test(id) || length <= 0 || nextOffset > end) {
      return { reason: 'invalid-id3v2-frame' };
    }
    if (bytes.readUInt16BE(offset + 8) !== 0) return { reason: 'unsupported-id3v2-frame-flags' };
    if (!isProductionFrame(id, bytes.subarray(frameStart, nextOffset))) {
      return { reason: `unrecognized-or-playback-id3v2-frame:${id}` };
    }
    offset = nextOffset;
  }
  return { end };
}

function hasCompleteMpegFrames(bytes, start, end) {
  let offset = start;
  let count = 0;
  let streamFormat;
  while (end - offset >= 4) {
    const [sync, format, rate, mode] = bytes.subarray(offset, offset + 4);
    const version = (format >> 3) & 3;
    const layer = (format >> 1) & 3;
    const sampleIndex = (rate >> 2) & 3;
    const isMpeg1 = version === 3;
    const bitrate = (isMpeg1 ? bitrateV1 : bitrateV2)[rate >> 4];
    if (sync !== 0xff || (format & 0xe0) !== 0xe0 || version === 1 || layer !== 1
      || sampleIndex === 3 || !bitrate || (mode & 3) === 2) return false;
    const sampleRate = sampleRates[sampleIndex] / (isMpeg1 ? 1 : version === 2 ? 2 : 4);
    const mono = (mode >> 6) === 3;
    const description = `${version}/${sampleRate}/${mono}`;
    if (streamFormat && streamFormat !== description) return false;
    streamFormat = description;
    const length = Math.floor((isMpeg1 ? 144000 : 72000) * bitrate / sampleRate) + ((rate >> 1) & 1);
    const sideInfoBytes = isMpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const crcBytes = (format & 1) ? 0 : 2;
    if (length < 4 + crcBytes + sideInfoBytes || offset + length > end) return false;
    offset += length;
    count += 1;
  }
  return offset === end && count >= 2;
}

export function stripMp3ProductionTags(bytes) {
  const tag = startsWith(bytes, 'ID3') ? readLeadingTag(bytes) : { end: 0 };
  if (tag.reason) return { bytes, reason: tag.reason };
  const start = tag.end;
  const tail = bytes.length - 128;
  const hasId3v1 = tail > start && startsWith(bytes, 'TAG', tail);
  if (!start && !hasId3v1) return { bytes, reason: 'no-supported-production-tags' };
  if (hasId3v1 && hasCompleteMpegFrames(bytes, start, tail)) {
    return { bytes: bytes.subarray(start, tail), reason: start ? 'removed-id3v2-and-id3v1' : 'removed-id3v1' };
  }
  // A TAG marker inside the last frame can resemble ID3v1. Only cut at a
  // validated boundary and leave every byte of the MPEG frames intact.
  if (hasCompleteMpegFrames(bytes, start, bytes.length)) {
    return { bytes: bytes.subarray(start), reason: start ? 'removed-id3v2' : 'no-supported-production-tags' };
  }
  return { bytes, reason: 'invalid-or-unrecognized-mpeg-boundary' };
}
