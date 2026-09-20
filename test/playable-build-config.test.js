import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGeneratedBuildConfigSource,
  createPlayableBuildConfig,
  createPlayableBuildSignature,
  createPlayablePackageMetadata,
  injectPlayablePackageMetadata,
  parsePlayablePackageMetadata
} from '../scripts/playable-build-config.mjs';

function tuning(overrides = {}) {
  const base = {
    level: { selected: 'level43' },
    installGate: {
      successfulOperationThreshold: 8,
      continueAfterStoreOpen: 1,
      vehicleExitGateEnabled: 0,
      vehicleExitLevelKey: 'level43',
      vehicleExitIds: '50,69'
    },
    retryButton: { enabled: 1 },
    gameOver: { retryEnabled: 1 }
  };
  return {
    ...base,
    ...overrides,
    installGate: {
      ...base.installGate,
      ...overrides.installGate
    }
  };
}

test('different redirect strategies produce different baked configs and signatures', () => {
  const operationConfig = createPlayableBuildConfig(tuning());
  const vehicleConfig = createPlayableBuildConfig(tuning({
    installGate: {
      successfulOperationThreshold: 3,
      continueAfterStoreOpen: 0,
      vehicleExitGateEnabled: 1,
      vehicleExitLevelKey: 'level29',
      vehicleExitIds: '12,18'
    }
  }));

  assert.notDeepEqual(operationConfig, vehicleConfig);
  assert.notEqual(
    createPlayableBuildSignature(operationConfig),
    createPlayableBuildSignature(vehicleConfig)
  );
  assert.deepEqual(vehicleConfig.installGate, {
    successfulOperationThreshold: 3,
    continueAfterStoreOpen: false,
    vehicleExitGateEnabled: true,
    vehicleExitLevelKey: 'level29',
    vehicleExitIds: '12,18'
  });
});

test('package metadata preserves exact baked redirect and retry settings', () => {
  const config = createPlayableBuildConfig(tuning());
  const signature = createPlayableBuildSignature(config);
  const metadata = createPlayablePackageMetadata(config, signature);
  const html = injectPlayablePackageMetadata('<html><head></head><body></body></html>', metadata);

  assert.deepEqual(parsePlayablePackageMetadata(html), metadata);
  assert.match(createGeneratedBuildConfigSource(config, signature), new RegExp(signature));
});

test('AppLovin pipeline rejects stale dist and checks exact package metadata', () => {
  const packageSource = readFileSync('scripts/package-applovin-single-html.mjs', 'utf8');
  const checkerSource = readFileSync('scripts/check-applovin-package.mjs', 'utf8');
  const mainSource = readFileSync('src/main.js', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.match(packageSource, /jsSource\.includes\(expectedBuildSignature\)/);
  assert.match(packageSource, /injectPlayablePackageMetadata/);
  assert.match(checkerSource, /package metadata exactly matches redirect\/retry settings/);
  assert.match(checkerSource, /runtime bundle signature matches package metadata/);
  assert.match(mainSource, /dataset\.busLoopBuildSignature = PLAYABLE_BUILD_SIGNATURE/);
  assert.match(packageJson.scripts['package:applovin'], /package:applovin:verified/);
  assert.match(packageJson.scripts['package:applovin:verified'], /apply:tuning/);
  assert.match(packageJson.scripts['package:applovin:verified'], /npm run build/);
});
