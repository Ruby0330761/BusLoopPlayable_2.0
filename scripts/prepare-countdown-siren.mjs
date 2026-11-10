// Builds the countdown's ambulance siren loop.
//
// The supplied ambulance audio only carries a 0.3 s "countdown" blip, which is
// played once per remaining move rather than looping. A loop has to be its own
// clip, so this synthesises the classic two-tone hi-lo siren (960 Hz / 770 Hz,
// half a second each) and encodes it small enough for the single-HTML budget.
//
// The loop is phase-continuous: every segment starts and ends on a zero
// crossing with a short envelope, so the wrap has no click. Run with
// `node scripts/prepare-countdown-siren.mjs` and commit the MP3 it writes.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUTPUT = path.join('public', 'assets', 'applovin', 'countdown', 'ambulance-siren.mp3');
const SAMPLE_RATE = 22050;
const SEGMENT_SECONDS = 0.5;
// One cycle is hi-then-lo twice; two seconds is long enough to read as a siren
// and short enough that the repeat is not distracting under a 60 s countdown.
const SEGMENTS = [960, 770, 960, 770];

function synthesise() {
  const frames = [];
  const segmentFrames = Math.round(SAMPLE_RATE * SEGMENT_SECONDS);
  for (const frequency of SEGMENTS) {
    for (let index = 0; index < segmentFrames; index += 1) {
      const phase = (index / SAMPLE_RATE) * frequency * Math.PI * 2;
      // Fundamental plus a quiet second harmonic: a pure sine reads as a test
      // tone, and the harmonic is what makes it sound like a vehicle horn.
      const sample = Math.sin(phase) * 0.78 + Math.sin(phase * 2) * 0.16;
      // 8 ms raised-cosine edges keep the tone changes from clicking. Both ends
      // land on silence so the loop point is sample-continuous.
      const edge = Math.min(index, segmentFrames - 1 - index) / (SAMPLE_RATE * 0.008);
      const envelope = edge >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, edge));
      frames.push(Math.round(Math.max(-1, Math.min(1, sample * envelope)) * 32767));
    }
  }
  const data = Buffer.alloc(frames.length * 2);
  frames.forEach((value, index) => data.writeInt16LE(value, index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}.\n${stderr}`));
    });
  });
}

const ffmpegCandidates = [
  process.env.FFMPEG_PATH,
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  path.join(os.homedir(), '.local', 'bin', 'ffmpeg')
].filter(Boolean);
const ffmpeg = ffmpegCandidates.find((candidate) => existsSync(candidate)) ?? 'ffmpeg';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'countdown-siren-'));
const wavPath = path.join(tempRoot, 'ambulance-siren.wav');
try {
  await writeFile(wavPath, synthesise());
  await run(ffmpeg, [
    '-v', 'error',
    '-i', wavPath,
    '-codec:a', 'libmp3lame',
    '-b:a', '48k',
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-y', OUTPUT
  ]);
  console.log(`Wrote ${OUTPUT}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
