import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONVEYOR_MECHANISM_TUNING } from '../src/conveyor-mechanism-config.js';

test('confirmed conveyor mechanism values are isolated from editor tuning', () => {
  assert.equal(CONVEYOR_MECHANISM_TUNING.visualRootScale, 1.375);
  assert.equal(CONVEYOR_MECHANISM_TUNING.leftDoorOutwardScale, 1.17);
  assert.equal(CONVEYOR_MECHANISM_TUNING.rightDoorOutwardScale, 1.2);
  assert.equal(CONVEYOR_MECHANISM_TUNING.rightVehicleVisibilityScale, 0.93);
  const expected = {
    belt: {
      positionX: 0,
      positionY: -0.01,
      positionZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1.5,
      rotationXDegrees: 0,
      rotationYDegrees: 0,
      rotationZDegrees: 0
    },
    arrow: {
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      scaleX: 1.5,
      scaleY: 1,
      scaleZ: 1.05,
      rotationXDegrees: 0,
      rotationYDegrees: 0,
      rotationZDegrees: 0
    },
    doorLeft: {
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1.2,
      rotationXDegrees: 150,
      rotationYDegrees: 0,
      rotationZDegrees: 0
    },
    doorRight: {
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1.2,
      rotationXDegrees: 150,
      rotationYDegrees: 0,
      rotationZDegrees: 0
    },
    sideLeft: {
      positionX: -4,
      positionY: 0,
      positionZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      rotationXDegrees: 0,
      rotationYDegrees: 0,
      rotationZDegrees: 0
    },
    sideRight: {
      positionX: 4,
      positionY: 0,
      positionZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      rotationXDegrees: 0,
      rotationYDegrees: 0,
      rotationZDegrees: 0
    }
  };
  for (const [name, component] of Object.entries(CONVEYOR_MECHANISM_TUNING.components)) {
    assert.deepEqual(component, expected[name]);
  }
});

test('runtime keeps fixed mechanism values outside resettable editor tuning', () => {
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  const mainSource = readFileSync('src/main.js', 'utf8');
  const applySource = readFileSync('scripts/apply-scene-tuning.mjs', 'utf8');
  const viewSource = readFileSync('src/scene-view.js', 'utf8');
  assert.doesNotMatch(editorSource, /CONVEYOR_COMPONENT_FIELD_GROUPS/);
  assert.doesNotMatch(editorSource, /conveyorVisual\.components/);
  assert.match(mainSource, /delete savedTuning\.conveyorVisual/);
  assert.match(mainSource, /delete legacy\.conveyorVisual/);
  assert.match(applySource, /delete patch\.conveyorVisual/);
  assert.match(applySource, /delete next\.conveyorVisual/);
  assert.match(viewSource, /CONVEYOR_MECHANISM_TUNING/);
  assert.doesNotMatch(viewSource, /SCENE_TUNING\.conveyorVisual/);
  assert.doesNotMatch(viewSource, /temporaryComponents\[key\]/);
});
