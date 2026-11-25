// sRGB values sampled inside the original Car/Van/Bus UV islands. In order:
// 0-4 shell and raised panels, 5 glass, 6 tyres, 7-8 rear lamps, 9 grille,
// 10-11 headlights, 12-13 trim and hubs, 14-15 van nose / bus roof inset.
const samples = {
  0: '4090fe a9d7ff 4090fe 73acff 5baeff 0838a8 0064e6 ff5e40 ff5e40 7d9584 fff14b fff14b d0ccd2 d0ccd2 0052bf 0063f0',
  1: '1ed533 e2ffe7 1ed533 36e84c 5aed4a 277b33 20722b ff3724 ff3724 7e7d80 ffe77d ffe77d c8c4cc c8c4cc 09621b 118e21',
  2: 'fc49b1 d7b8d0 fc49b1 ff74cc ff75dc 930d51 c51570 ff472d ff472d a35a85 ffbd2b ffbc2b ef87c6 ef87c6 d20d76 d20d78',
  3: 'a02fee d79bf3 a02fee c26bfa b661f1 650e9b 781bb5 ff593c ff593c 807f84 fad647 fad645 aaa9ae aaa9ae 620c98 7d15c5',
  4: 'f82b2c fabcbf f82b2c fe4a4e ff4f56 860a06 b31415 fd4c2f ff4b31 6a7e71 fecc30 fecc30 bababa bababa b50d0c a70f10',
  5: 'fbbb02 fffae5 fbbb02 ffd966 ffe185 a84b00 fd7501 ff5c21 ff5b23 b3b3b3 ffeea7 ffeea5 dddddd dddddd cd7e00 ba8a00',
  6: 'ff6a00 ffe4c7 ff6a00 fe8a2b ff9139 8b2601 c93700 d20b03 d20c01 779980 ffcc2e ffcc2e c6c6c6 c6c6c6 b83804 9d4700',
  7: '06d2f1 ffffff 06d2f1 13def5 24e3f2 057779 016d76 ff320a ff3308 423e44 f1cc17 f1cc17 8f8793 8f8793 024049 037986',
  8: '883d2b d6baa4 883d2b 604a29 9f5f2c 4a2319 612b1b ff4b2f ff4a31 616161 eccb34 eacc34 808082 808082 43170b 5f2416',
  9: '1f9a80 a2f1d8 1f9a80 3fbd8e 21ba8b 146948 267e59 fd6547 ff6447 8b8a8d 8ffe90 91fd90 bdbcbf bdbcbf 0a6853 0b604f',
  10: '232bf8 91abf9 232bf8 2836e9 305cf1 0d187f 182766 ff4b31 ff4b31 706d71 fecc30 fecc30 a9a6aa a9a6aa 0b11a1 0e1371',
  17: '1f1f1f 333333 1f1f1f 1f1f1f 1f1f1f 4c4c4c 4c4c4c ff3724 ff3822 7e7d80 fcffb3 fcffb1 929292 929292 333333 101010',
  18: 'f3f4f1 d0d0d0 f3f4f1 f7f7f5 f7f7f5 8e8e8c bebebc ff3724 ff3724 7e7d80 ffe77d ffe77d c8c4cc c8c4cc cbcbc9 cbcbcb',
  19: 'c42728 c69696 c42728 c9403e c84443 6b0b09 901310 ff3724 ff3724 7e7d80 ffe77d ffe77d c8c4cc c8c4cc 8c1013 841212',
  20: 'ffc10b fff9e7 ffc10b ffda6c ffe28a a88108 ffc20d ff3724 ff3724 7e7d80 ffe77d ffe77d f8d682 f8d682 d09d06 bb8f08',
  21: 'f7e8c9 d4d0ca f7e8c9 faeed6 faeed6 91856e bfb294 ff3724 ff3724 7e7d80 ffe77d ffe77d c8c4cc c8c4cc cebc9b cebc9b',
  22: '77ffd4 c8ffec 77ffd4 8efedb 71ffd1 57bf9e 79e7c4 ff3724 ff3724 7e7d80 ffe77d ffe77d c8c4cc c8c4cc 49b592 49b592',
  23: 'befea6 f9fff7 befea6 d9ffc7 e1ffd5 80a96e c2fea5 ff3724 ff3724 7e7d80 ffe77d ffe77d d2e379 d2e379 9acf86 8fbb7e',
  24: 'fea6cf dac9d1 fea6cf feb9da ffbadb 955071 c66e95 ff3724 ff3724 7e7d80 ffe77d ffe77b fdc7e0 fdc7e0 d572a1 d572a1',
  25: 'afb1b5 b6b5b8 afb1b5 b9bbbc b3b5b6 727475 838587 ff3724 ff3724 7e7d80 ffe77d ffe77d c8c4cc c8c4cc 717374 909294',
};
const palettes = Object.fromEntries(Object.entries(samples).map(([slot, row]) =>
  [slot, row.split(' ').map(hex => '#' + hex)]));
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luma = hex => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function vehicleSurfaceColors(colorIndex, customBody) {
  const preset = palettes[colorIndex] ?? palettes[0];
  if (!customBody) return preset;
  const body = channels(customBody);
  const base = luma(preset[0]);
  return preset.map((sample, i) => {
    // Keep lens, grille and hardware pigments independent of the body picker.
    if (i >= 7 && i <= 13) return sample;
    const delta = luma(sample) - base;
    const target = delta > 0 ? 255 : 0;
    const amount = Math.abs(delta) / Math.max(1, Math.abs(target - base));
    return '#' + body.map(c => Math.round(c + (target - c) * amount).toString(16).padStart(2, '0')).join('');
  });
}
