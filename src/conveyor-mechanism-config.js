// Confirmed conveyor-mechanism tuning. This file is intentionally separate
// from editor-owned SCENE_TUNING so temporary saved tuning and reset cannot
// change the shipped conveyor presentation or visibility rules.
const componentDefaults = Object.freeze({
  belt: Object.freeze({
    positionX: 0,
    positionY: -0.01,
    positionZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1.5,
    rotationXDegrees: 0,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  }),
  arrow: Object.freeze({
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    scaleX: 1.5,
    scaleY: 1,
    scaleZ: 1.05,
    rotationXDegrees: 0,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  }),
  doorLeft: Object.freeze({
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1.2,
    rotationXDegrees: 150,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  }),
  doorRight: Object.freeze({
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1.2,
    rotationXDegrees: 150,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  }),
  sideLeft: Object.freeze({
    positionX: -4,
    positionY: 0,
    positionZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    rotationXDegrees: 0,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  }),
  sideRight: Object.freeze({
    positionX: 4,
    positionY: 0,
    positionZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    rotationXDegrees: 0,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  })
});

export const CONVEYOR_MECHANISM_TUNING = Object.freeze({
  visualRootScale: 1.375,
  leftDoorOutwardScale: 1.17,
  rightDoorOutwardScale: 1.2,
  rightVehicleVisibilityScale: 0.93,
  components: componentDefaults
});
