import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../artifacts/web-levels/', import.meta.url);
const source = JSON.parse(await readFile(new URL('level48.json', root), 'utf8'));
const variants = [
  ['level49', 'Q5V2', 49, 2, 1],
  ['level50', 'Q5V3', 50, 3, 6],
  ['level51', 'Q5V4', 51, 0, 5]
];

for (const [key, displayName, unityId, leftColor, rightColor] of variants) {
  const level = structuredClone(source);
  level.key = key;
  level.displayName = displayName;
  level.unityId = unityId;
  for (const vehicle of level.vehicles) {
    const sourceColor = vehicle.colorIndex;
    vehicle.colorIndex = sourceColor === 22 ? leftColor : rightColor;
  }
  for (const queue of level.passengerQueues) {
    for (let index = 0; index < queue.length; index += 1) {
      queue[index] = queue[index] === 22 ? leftColor : rightColor;
    }
  }
  await writeFile(new URL(`${key}.json`, root), `${JSON.stringify(level, null, 2)}\n`);
}
