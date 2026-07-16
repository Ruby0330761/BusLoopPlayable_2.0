import { LEVEL_OPTIONS } from './level-catalog.js';

const CONVEYOR_LAYOUT_OPTIONS = [
  ['dualQueue2', 'GameSceneDualQueue2'],
  ['dualQueue3', 'GameSceneDualQueue3'],
  ['dualQueue5', 'GameSceneDualQueue5'],
  ['dualQueue10', 'GameSceneDualQueue10']
];

function makeConveyorLayoutGroups(layoutId, label) {
  const root = `conveyorLayouts.${layoutId}`;
  return [
    {
      title: `${label} - \u56fe\u7247`,
      conveyorLayout: layoutId,
      fields: [
        ['X \u5750\u6807', `${root}.art.x`, -10, 10, 0.05],
        ['Z \u5750\u6807', `${root}.art.z`, -10, 10, 0.05],
        ['X \u5c3a\u5bf8', `${root}.art.width`, 2, 24, 0.05],
        ['Z \u5c3a\u5bf8', `${root}.art.depth`, 2, 18, 0.05]
      ]
    },
    {
      title: `${label} - \u4e58\u5ba2\u8f68\u8ff9`,
      conveyorLayout: layoutId,
      fields: [
        ['\u95ed\u73af X', `${root}.curve.offsetX`, -6, 6, 0.05],
        ['\u95ed\u73af Z', `${root}.curve.offsetZ`, -6, 6, 0.05],
        ['\u95ed\u73af X \u5c3a\u5bf8', `${root}.curve.scaleX`, 0.25, 3, 0.05],
        ['\u95ed\u73af Z \u5c3a\u5bf8', `${root}.curve.scaleZ`, 0.25, 3, 0.05],
        ['\u5165\u53e3 1 X', `${root}.queueCurves.0.offsetX`, -6, 6, 0.05],
        ['\u5165\u53e3 1 Z', `${root}.queueCurves.0.offsetZ`, -6, 6, 0.05],
        ['\u5165\u53e3 2 X', `${root}.queueCurves.1.offsetX`, -6, 6, 0.05],
        ['\u5165\u53e3 2 Z', `${root}.queueCurves.1.offsetZ`, -6, 6, 0.05]
      ]
    }
  ];
}

const CONVEYOR_LAYOUT_FIELD_GROUPS = CONVEYOR_LAYOUT_OPTIONS.flatMap(([layoutId, label]) => (
  makeConveyorLayoutGroups(layoutId, label)
));

const FIELD_GROUPS = [
  {
    title: '\u5173\u5361',
    fields: [
      ['\u5f53\u524d\u5173\u5361', 'level.selected', 0, 0, 1, LEVEL_OPTIONS]
    ]
  },
  {
    title: '\u624b\u673a\u9884\u89c8',
    fields: [
      ['\u542f\u7528', 'preview.enabled', 0, 1, 1],
      ['\u5bbd\u5ea6', 'preview.width', 320, 2160, 1],
      ['\u9ad8\u5ea6', 'preview.height', 640, 4320, 1]
    ]
  },
  {
    title: '\u76f8\u673a',
    fields: [
      ['\u4fef\u89d2', 'camera.elevationDegrees', 25, 80, 1],
      ['\u900f\u89c6 FOV', 'camera.fovDegrees', 1, 40, 0.1],
      ['\u76ee\u6807 X', 'camera.targetX', -10, 10, 0.05],
      ['\u76ee\u6807 Z', 'camera.targetZ', -12, 12, 0.05],
      ['\u753b\u9762\u5bbd\u5ea6', 'camera.fitWidth', 8, 30, 0.1],
      ['\u753b\u9762\u9ad8\u5ea6', 'camera.fitHeight', 8, 36, 0.1]
    ]
  },
  {
    title: '\u65b9\u5411\u5149',
    fields: [
      ['\u542f\u7528', 'lighting.directional.enabled', 0, 1, 1],
      ['\u989c\u8272 Hex', 'lighting.directional.color', 0, 16777215, 1],
      ['\u5f3a\u5ea6', 'lighting.directional.intensity', 0, 5, 0.01],
      ['X \u5750\u6807', 'lighting.directional.position.x', -20, 20, 0.05],
      ['Y \u5750\u6807', 'lighting.directional.position.y', -2, 30, 0.05],
      ['Z \u5750\u6807', 'lighting.directional.position.z', -20, 20, 0.05],
      ['X \u89d2\u5ea6', 'lighting.directional.eulerDegrees.x', -180, 180, 0.5],
      ['Y \u89d2\u5ea6', 'lighting.directional.eulerDegrees.y', -180, 180, 0.5],
      ['Z \u89d2\u5ea6', 'lighting.directional.eulerDegrees.z', -180, 180, 0.5]
    ]
  },
  {
    title: '\u6e90\u56fe\u88c1\u5207',
    fields: [
      ['\u542f\u7528', 'sourceCrop.enabled', 0, 1, 1],
      ['\u7a97\u53e3\u5bbd', 'sourceCrop.width', 320, 2100, 1],
      ['\u7a97\u53e3\u9ad8', 'sourceCrop.height', 640, 3382, 1],
      ['X \u504f\u79fb', 'sourceCrop.offsetX', -1020, 1020, 1],
      ['Y \u504f\u79fb', 'sourceCrop.offsetY', -1222, 1222, 1]
    ]
  },
  {
    title: '\u5c0f\u4eba\u6a21\u578b',
    fields: [
      ['\u7edf\u4e00\u5927\u5c0f', 'passengers.modelScale', 0.2, 2, 0.01],
      ['\u540c\u6392\u95f4\u8ddd', 'passengers.groupSpacing', 0.03, 0.5, 0.01]
    ]
  },
  {
    title: 'CTA',
    fields: [
      ['Enabled', 'cta.enabled', 0, 1, 1],
      ['X', 'cta.x', 0, 1080, 1],
      ['Y', 'cta.y', 0, 2160, 1],
      ['World X', 'cta.worldX', -10, 10, 0.01],
      ['World Y', 'cta.worldY', -1, 4, 0.01],
      ['World Z', 'cta.worldZ', -12, 16, 0.01],
      ['Height', 'cta.height', 36, 140, 1],
      ['Stretch X', 'cta.stretchX', 1, 5, 0.01],
      ['Font Size', 'cta.fontSize', 12, 64, 1],
      ['Font Height', 'cta.fontHeight', 8, 100, 1],
      ['Stroke Color', 'cta.strokeColor', 0, 16777215, 1],
      ['Stroke Width', 'cta.strokeWidth', 0, 8, 0.1],
      ['Pulse Scale', 'cta.pulseScale', 1, 1.35, 0.01],
      ['Pulse Speed', 'cta.pulseSpeed', 0.1, 3, 0.01],
      ['Appear Speed', 'cta.appearSpeed', 0.1, 5, 0.01]
    ]
  },
  {
    title: '\u5546\u5e97\u8df3\u8f6c',
    fields: [
      ['\u6210\u529f\u64cd\u4f5c\u6b21\u6570', 'installGate.successfulOperationThreshold', 1, 200, 1]
    ]
  },
  {
    title: 'Game Over',
    fields: [
      ['Fail Delay', 'gameOver.failureDelaySeconds', 0, 8, 0.1],
      ['Mask Opacity', 'gameOver.maskOpacity', 0, 1, 0.01],
      ['Title Font', 'gameOver.titleFont', 0, 0, 1, [
        ['rounded', 'Rounded Heavy'],
        ['impact', 'Impact'],
        ['system', 'System Bold']
      ]],
      ['Title Size', 'gameOver.titleFontSize', 24, 180, 1],
      ['Title Pop Speed', 'gameOver.titlePopSpeed', 0.1, 5, 0.01],
      ['Title Fade Speed', 'gameOver.titleFadeSpeed', 0.1, 5, 0.01],
      ['Logo X', 'gameOver.logoX', 0, 1080, 1],
      ['Logo Y', 'gameOver.logoY', 0, 2160, 1],
      ['Logo Width', 'gameOver.logoWidth', 40, 720, 1],
      ['Logo Height', 'gameOver.logoHeight', 40, 720, 1],
      ['Logo Radius', 'gameOver.logoRadius', 0, 120, 1],
      ['Logo Speed', 'gameOver.logoAppearSpeed', 0.1, 5, 0.01]
    ]
  },
  {
    title: 'Passenger Material',
    fields: [
      ['Mode', 'passengerMaterial.mode', 0, 0, 1, [
        ['unityTexture', 'Unity Texture'],
        ['solidColor', 'Solid Color']
      ]],
      ['Base Strength', 'passengerMaterial.baseColorStrength', 0, 2, 0.01],
      ['Emission Strength', 'passengerMaterial.emissionStrength', 0, 5, 0.01],
      ['Brightness', 'passengerMaterial.brightness', 0, 3, 0.01],
      ['Roughness', 'passengerMaterial.roughness', 0, 1, 0.01],
      ['Metalness', 'passengerMaterial.metalness', 0, 1, 0.01],
      ['Blue Color', 'passengerMaterial.solidColors.0', 0, 16777215, 1],
      ['Green Color', 'passengerMaterial.solidColors.1', 0, 16777215, 1],
      ['Pink Color', 'passengerMaterial.solidColors.2', 0, 16777215, 1],
      ['Purple Color', 'passengerMaterial.solidColors.3', 0, 16777215, 1],
      ['Red Color', 'passengerMaterial.solidColors.4', 0, 16777215, 1],
      ['Yellow Color', 'passengerMaterial.solidColors.5', 0, 16777215, 1],
      ['Orange Color', 'passengerMaterial.solidColors.6', 0, 16777215, 1],
      ['LightBlue Color', 'passengerMaterial.solidColors.7', 0, 16777215, 1],
      ['Brown Color', 'passengerMaterial.solidColors.8', 0, 16777215, 1],
      ['DarkGreen Color', 'passengerMaterial.solidColors.9', 0, 16777215, 1],
      ['DarkBlue Color', 'passengerMaterial.solidColors.10', 0, 16777215, 1],
      ['Blue Base', 'passengerMaterial.colors.0.baseColor', 0, 16777215, 1],
      ['Blue Emission', 'passengerMaterial.colors.0.emissionColor', 0, 16777215, 1],
      ['Green Base', 'passengerMaterial.colors.1.baseColor', 0, 16777215, 1],
      ['Green Emission', 'passengerMaterial.colors.1.emissionColor', 0, 16777215, 1],
      ['Pink Base', 'passengerMaterial.colors.2.baseColor', 0, 16777215, 1],
      ['Pink Emission', 'passengerMaterial.colors.2.emissionColor', 0, 16777215, 1],
      ['Purple Base', 'passengerMaterial.colors.3.baseColor', 0, 16777215, 1],
      ['Purple Emission', 'passengerMaterial.colors.3.emissionColor', 0, 16777215, 1],
      ['Red Base', 'passengerMaterial.colors.4.baseColor', 0, 16777215, 1],
      ['Red Emission', 'passengerMaterial.colors.4.emissionColor', 0, 16777215, 1],
      ['Yellow Base', 'passengerMaterial.colors.5.baseColor', 0, 16777215, 1],
      ['Yellow Emission', 'passengerMaterial.colors.5.emissionColor', 0, 16777215, 1],
      ['Orange Base', 'passengerMaterial.colors.6.baseColor', 0, 16777215, 1],
      ['Orange Emission', 'passengerMaterial.colors.6.emissionColor', 0, 16777215, 1],
      ['LightBlue Base', 'passengerMaterial.colors.7.baseColor', 0, 16777215, 1],
      ['LightBlue Emission', 'passengerMaterial.colors.7.emissionColor', 0, 16777215, 1],
      ['Brown Base', 'passengerMaterial.colors.8.baseColor', 0, 16777215, 1],
      ['Brown Emission', 'passengerMaterial.colors.8.emissionColor', 0, 16777215, 1],
      ['DarkGreen Base', 'passengerMaterial.colors.9.baseColor', 0, 16777215, 1],
      ['DarkGreen Emission', 'passengerMaterial.colors.9.emissionColor', 0, 16777215, 1],
      ['DarkBlue Base', 'passengerMaterial.colors.10.baseColor', 0, 16777215, 1],
      ['DarkBlue Emission', 'passengerMaterial.colors.10.emissionColor', 0, 16777215, 1]
    ]
  },
  {
    title: '\u4f20\u9001\u5e26\u5f62\u72b6',
    fields: [
      ['Prefab', 'conveyorLayout.selected', 0, 0, 1, CONVEYOR_LAYOUT_OPTIONS]
    ]
  },
  ...CONVEYOR_LAYOUT_FIELD_GROUPS,
  {
    title: '\u4e2d\u95f4\u5c0f\u4eba\u5f71\u5b50',
    fields: [
      ['X \u5750\u6807', 'passengerShadows.conveyor.offsetX', -1.5, 1.5, 0.01],
      ['Z \u5750\u6807', 'passengerShadows.conveyor.offsetZ', -1.5, 1.5, 0.01],
      ['X \u5c3a\u5bf8', 'passengerShadows.conveyor.scaleX', 0.2, 3, 0.01],
      ['Z \u5c3a\u5bf8', 'passengerShadows.conveyor.scaleZ', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u5de6\u4fa7\u961f\u5217\u66f2\u7ebf',
    fields: [
      ['X \u5750\u6807', 'queueCurves.0.offsetX', -6, 6, 0.05],
      ['Z \u5750\u6807', 'queueCurves.0.offsetZ', -6, 6, 0.05],
      ['X \u5c3a\u5bf8', 'queueCurves.0.scaleX', 0.25, 3, 0.05],
      ['Z \u5c3a\u5bf8', 'queueCurves.0.scaleZ', 0.25, 3, 0.05]
    ]
  },
  {
    title: '\u5de6\u961f\u5217\u5c0f\u4eba\u5f71\u5b50',
    fields: [
      ['X \u5750\u6807', 'passengerShadows.leftQueue.offsetX', -1.5, 1.5, 0.01],
      ['Z \u5750\u6807', 'passengerShadows.leftQueue.offsetZ', -1.5, 1.5, 0.01],
      ['X \u5c3a\u5bf8', 'passengerShadows.leftQueue.scaleX', 0.2, 3, 0.01],
      ['Z \u5c3a\u5bf8', 'passengerShadows.leftQueue.scaleZ', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u53f3\u4fa7\u961f\u5217\u66f2\u7ebf',
    fields: [
      ['X \u5750\u6807', 'queueCurves.1.offsetX', -6, 6, 0.05],
      ['Z \u5750\u6807', 'queueCurves.1.offsetZ', -6, 6, 0.05],
      ['X \u5c3a\u5bf8', 'queueCurves.1.scaleX', 0.25, 3, 0.05],
      ['Z \u5c3a\u5bf8', 'queueCurves.1.scaleZ', 0.25, 3, 0.05]
    ]
  },
  {
    title: '\u53f3\u961f\u5217\u5c0f\u4eba\u5f71\u5b50',
    fields: [
      ['X \u5750\u6807', 'passengerShadows.rightQueue.offsetX', -1.5, 1.5, 0.01],
      ['Z \u5750\u6807', 'passengerShadows.rightQueue.offsetZ', -1.5, 1.5, 0.01],
      ['X \u5c3a\u5bf8', 'passengerShadows.rightQueue.scaleX', 0.2, 3, 0.01],
      ['Z \u5c3a\u5bf8', 'passengerShadows.rightQueue.scaleZ', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u8f66\u4f4d',
    fields: [
      ['\u8f66\u4f4d\u6570', 'parkingSpots.count', 1, 8, 1],
      ['\u8d77\u70b9 X', 'parkingSpots.startX', -8, 2, 0.05],
      ['Z \u5750\u6807', 'parkingSpots.z', -6, 6, 0.05],
      ['\u8f66\u4f4d\u95f4\u8ddd', 'parkingSpots.spacing', 0.25, 2.5, 0.05],
      ['\u8f66\u4f4d\u89d2\u5ea6', 'facing.parkingSpotYawDegrees', -180, 180, 1],
      ['\u8ba1\u6570\u677f X', 'seatCountBoard.x', -2, 2, 0.01],
      ['\u8ba1\u6570\u677f Z', 'seatCountBoard.z', -2, 2, 0.01],
      ['\u8ba1\u6570\u677f\u5bbd', 'seatCountBoard.width', 0.1, 1.5, 0.01],
      ['\u8ba1\u6570\u677f\u9ad8', 'seatCountBoard.depth', 0.1, 1.2, 0.01],
      ['\u6570\u5b57\u5927\u5c0f', 'seatCountBoard.textScale', 0.3, 2.5, 0.01],
      ['X \u5c3a\u5bf8', 'parkingSpots.scaleX', 0.25, 3, 0.05],
      ['Z \u5c3a\u5bf8', 'parkingSpots.scaleZ', 0.25, 3, 0.05]
    ]
  },
  {
    title: '\u8f66\u8f86\u884c\u9a76\u8def\u5f84',
    fields: [
      ['\u663e\u793a\u8def\u5f84', 'vehiclePath.enabled', 0, 1, 1],
      ['\u663e\u793a\u88ab\u6321\u8f66', 'vehiclePath.showBlocked', 0, 1, 1],
      ['\u7ebf\u6761\u9ad8\u5ea6', 'vehiclePath.y', 0.02, 0.5, 0.005],
      ['\u7ebf\u6761\u900f\u660e\u5ea6', 'vehiclePath.opacity', 0.1, 1, 0.01],
      ['\u7ebf\u6761\u7c97\u7ec6', 'vehiclePath.lineWidth', 1, 12, 1],
      ['\u8f6c\u5f2f\u534a\u5f84', 'vehiclePath.turnRadius', 0.05, 1.5, 0.01],
      ['\u5165\u5f2f\u63a7\u5236', 'vehiclePath.turnInController', 0, 1.5, 0.01],
      ['\u51fa\u5f2f\u63a7\u5236', 'vehiclePath.turnOutController', 0, 1.5, 0.01],
      ['\u8fb9\u754c\u5de6 X', 'vehiclePath.parkingBounds.minX', -6, 0, 0.01],
      ['\u8fb9\u754c\u53f3 X', 'vehiclePath.parkingBounds.maxX', 0, 6, 0.01],
      ['\u8fb9\u754c\u4e0b Z', 'vehiclePath.parkingBounds.minZ', -6, 0, 0.01],
      ['\u8fb9\u754c\u4e0a Z', 'vehiclePath.parkingBounds.maxZ', 0, 6, 0.01]
    ]
  },
  {
    title: '\u8f66\u8f86\u5f00\u51fa\u8f66\u4f4d\u8def\u5f84',
    fields: [
      ['\u663e\u793a\u8def\u5f84', 'vehicleDeparturePath.enabled', 0, 1, 1],
      ['\u6ee1\u8f7d\u505c\u987f', 'vehicleDeparturePath.fullLoadDelay', 0, 4, 0.05],
      ['\u7ebf\u6761\u9ad8\u5ea6', 'vehicleDeparturePath.y', -3, 0.5, 0.005],
      ['\u7ebf\u6761\u900f\u660e\u5ea6', 'vehicleDeparturePath.opacity', 0.1, 1, 0.01],
      ['\u7ebf\u6761\u7c97\u7ec6', 'vehicleDeparturePath.lineWidth', 1, 12, 1],
      ['\u5012\u8f66\u8ddd\u79bb', 'vehicleDeparturePath.backDistance', 0, 2, 0.01],
      ['\u6a2a\u5411\u62d0\u70b9 X', 'vehicleDeparturePath.exitTurnOffsetX', -2, 2, 0.01],
      ['\u79bb\u573a\u7ec8\u70b9 X', 'vehicleDeparturePath.exitTargetX', -1, 8, 0.05],
      ['\u79bb\u573a\u7ec8\u70b9 Z \u504f\u79fb', 'vehicleDeparturePath.exitTargetZOffset', -3, 3, 0.05],
      ['\u5012\u8f66\u901f\u5ea6', 'vehicleDeparturePath.backwardSpeed', 0.5, 8, 0.05],
      ['\u79bb\u573a\u901f\u5ea6', 'vehicleDeparturePath.forwardSpeed', 1, 18, 0.05],
      ['\u8f6c\u5f2f\u534a\u5f84', 'vehicleDeparturePath.turnRadius', 0.05, 1.5, 0.01],
      ['\u5165\u5f2f\u63a7\u5236', 'vehicleDeparturePath.turnInController', 0, 1.5, 0.01],
      ['\u51fa\u5f2f\u63a7\u5236', 'vehicleDeparturePath.turnOutController', 0, 1.5, 0.01]
    ]
  },
  {
    title: '\u8f66\u8f86',
    fields: [
      ['Map Scale', 'vehicleArea.positionUnitScale', 0.6, 2.2, 0.01],
      ['\u6a21\u578b\u5927\u5c0f', 'vehicleArea.modelScale', 0.3, 2.5, 0.05],
      ['\u4e0a\u8f66\u653e\u5927\u500d\u6570', 'vehicleBoardingPulse.scale', 1, 2, 0.01],
      ['\u4e0a\u8f66\u7f29\u653e\u901f\u5ea6', 'vehicleBoardingPulse.speed', 0, 20, 0.1],
      ['\u5f15\u5bfc\u5c0f\u624b\u663e\u793a', 'vehicleGuideHand.enabled', 0, 1, 1],
      ['\u5f15\u5bfc\u8f66 ID', 'vehicleGuideHand.vehicleId', 1, 200, 1],
      ['\u5c0f\u624b X', 'vehicleGuideHand.offsetX', -3, 3, 0.01],
      ['\u5c0f\u624b\u9ad8\u5ea6', 'vehicleGuideHand.offsetY', 0, 3, 0.01],
      ['\u5c0f\u624b Z', 'vehicleGuideHand.offsetZ', -3, 3, 0.01],
      ['\u8d77\u70b9 X \u504f\u79fb', 'vehicleGuideHand.approachOffsetX', -2, 2, 0.01],
      ['\u8d77\u70b9 Z \u504f\u79fb', 'vehicleGuideHand.approachOffsetZ', -2, 2, 0.01],
      ['\u5c0f\u624b\u6574\u4f53\u5927\u5c0f', 'vehicleGuideHand.size', 0.1, 3, 0.01],
      ['\u5c0f\u624b\u5bbd\u5ea6', 'vehicleGuideHand.width', 0.1, 2, 0.01],
      ['\u5c0f\u624b\u9ad8\u5ea6', 'vehicleGuideHand.height', 0.1, 2, 0.01],
      ['\u9760\u8fd1\u7f29\u653e', 'vehicleGuideHand.nearScale', 0.1, 2, 0.01],
      ['\u8fdc\u79bb\u7f29\u653e', 'vehicleGuideHand.farScale', 0.1, 3, 0.01],
      ['\u5c0f\u624b\u901f\u5ea6', 'vehicleGuideHand.speed', 0.1, 6, 0.01],
      ['\u5c0f\u624b\u900f\u660e\u5ea6', 'vehicleGuideHand.opacity', 0, 1, 0.01],
      ['\u9996\u6b65\u906e\u7f69\u5f00\u542f', 'firstClickGuide.enabled', 0, 1, 1],
      ['\u9996\u6b65\u8f66 ID', 'firstClickGuide.vehicleId', 1, 200, 1],
      ['\u906e\u7f69\u6301\u7eed\u65f6\u95f4', 'firstClickGuide.durationSeconds', 0, 10, 0.1],
      ['\u906e\u7f69\u900f\u660e\u5ea6', 'firstClickGuide.maskOpacity', 0, 1, 0.01],
      ['\u9ad8\u4eae\u8fb9\u8ddd', 'firstClickGuide.holePadding', 0, 120, 1],
      ['\u9ad8\u4eae\u5bbd\u5ea6\u7f29\u653e', 'firstClickGuide.holeScaleX', 0.2, 3, 0.01],
      ['\u9ad8\u4eae\u9ad8\u5ea6\u7f29\u653e', 'firstClickGuide.holeScaleY', 0.2, 3, 0.01],
      ['\u7bad\u5934 X', 'vehicleArrow.offsetX', -0.8, 0.8, 0.01],
      ['\u7bad\u5934\u9ad8\u5ea6', 'vehicleArrow.offsetY', 0, 0.8, 0.01],
      ['\u7bad\u5934 Z', 'vehicleArrow.offsetZ', -0.8, 0.8, 0.01],
      ['\u7bad\u5934\u63cf\u8fb9\u8272', 'vehicleArrow.outlineColor', 0, 16777215, 1],
      ['\u7bad\u5934\u63cf\u8fb9\u7c97\u7ec6', 'vehicleArrow.outlineScale', 1, 1.8, 0.01],
      ['\u7bad\u5934\u63cf\u8fb9\u6df1\u5ea6\u6d4b\u8bd5', 'vehicleArrow.outlineDepthTest', 0, 1, 1]
    ]
  }
,
  {
    title: 'Effect_Hit \u7c92\u5b50',
    fields: [
      ['\u6574\u4f53\u5927\u5c0f', 'effects.hit.sizeScale', 0.1, 5, 0.01],
      ['ParticleHit_2 \u5927\u5c0f', 'effects.hit.particleHit2SizeScale', 0.1, 5, 0.01],
      ['ParticleHit_1 \u5927\u5c0f', 'effects.hit.particleHit1SizeScale', 0.1, 5, 0.01],
      ['ParticleHit \u5927\u5c0f', 'effects.hit.particleHitSizeScale', 0.1, 5, 0.01]
    ]
  },
  {
    title: '\u79bb\u573a\u5f69\u5e26\u7c92\u5b50',
    fields: [
      ['\u79fb\u52a8\u8303\u56f4', 'effects.ribbon.moveRange', 0.1, 6, 0.05],
      ['\u901f\u5ea6\u8d77\u70b9', 'effects.ribbon.speedStart', 0, 3, 0.01],
      ['\u66f2\u7ebf\u4e2d\u70b9\u65f6\u95f4', 'effects.ribbon.speedMidTime', 0, 1, 0.01],
      ['\u901f\u5ea6\u4e2d\u70b9', 'effects.ribbon.speedMid', 0, 3, 0.01],
      ['\u901f\u5ea6\u7ec8\u70b9', 'effects.ribbon.speedEnd', 0, 3, 0.01]
    ]
  },
  {
    title: '\u79bb\u573a\u70df\u96fe\u7c92\u5b50',
    fields: [
      ['\u79fb\u52a8\u8303\u56f4', 'effects.ribbonSmoke.moveRange', 0.1, 6, 0.05],
      ['\u901f\u5ea6\u8d77\u70b9', 'effects.ribbonSmoke.speedStart', 0, 3, 0.01],
      ['\u66f2\u7ebf\u4e2d\u70b9\u65f6\u95f4', 'effects.ribbonSmoke.speedMidTime', 0, 1, 0.01],
      ['\u901f\u5ea6\u4e2d\u70b9', 'effects.ribbonSmoke.speedMid', 0, 3, 0.01],
      ['\u901f\u5ea6\u7ec8\u70b9', 'effects.ribbonSmoke.speedEnd', 0, 3, 0.01]
    ]
  }
];

function getAtPath(target, path) {
  return path.split('.').reduce((value, key) => value?.[key], target);
}

function setAtPath(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((current, key) => current[key], target);
  parent[last] = value;
}

function formatValue(value, step) {
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(value).toFixed(decimals);
}

function formatColor(value) {
  const hex = Math.max(0, Math.min(0xffffff, Math.round(Number(value) || 0)));
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function createSceneEditor(root, { getTuning, setTuning, clearSavedTuning = () => {} }) {
  const defaults = structuredClone(getTuning());
  root.innerHTML = `
    <header class="editor-header">
      <div>
        <span class="editor-kicker">SCENE EDITOR</span>
        <h2>\u573a\u666f\u8c03\u8282</h2>
      </div>
      <button class="editor-toggle" type="button" aria-label="\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668" aria-expanded="true">\u00d7</button>
    </header>
    <div class="editor-body">
      <p class="editor-help">\u56fe\u7247\u4e0e\u884c\u8d70\u66f2\u7ebf\u53ef\u5206\u522b\u8c03\u8282\u3002\u6bcf\u6b21\u8c03\u6574\u4f1a\u81ea\u52a8\u4fdd\u5b58\u3002</p>
      <div class="editor-fields"></div>
      <button class="editor-reset" type="button">\u6062\u590d\u9ed8\u8ba4\u53c2\u6570</button>
    </div>
  `;

  const fieldsRoot = root.querySelector('.editor-fields');
  const inputs = new Map();

  for (const group of FIELD_GROUPS) {
    const section = document.createElement('section');
    section.className = 'editor-section';
    if (group.conveyorLayout) section.dataset.conveyorLayout = group.conveyorLayout;
    section.innerHTML = `<h3>${group.title}</h3>`;
    for (const [label, path, min, max, step, options] of group.fields) {
      const isColor = /color$/i.test(path) || /^passengerMaterial\.solidColors\.\d+$/.test(path);
      const row = document.createElement('label');
      row.className = 'editor-field';
      row.dataset.path = path;
      if (isColor) row.classList.add('editor-field-color');
      if (options) row.classList.add('editor-field-select');
      const optionsMarkup = options
        ? `<select class="editor-select">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`
        : '';
      const rangeMarkup = isColor
        ? ''
        : `<input class="editor-range" type="range" min="${min}" max="${max}" step="${step}">`;
      row.innerHTML = `
        <span>${label}</span>
        ${optionsMarkup}
        ${options ? '' : rangeMarkup}
        ${isColor && !options ? '<input class="editor-color" type="color">' : ''}
        ${options ? '' : `<input class="editor-number" type="number" min="${min}" max="${max}" step="${step}" aria-label="${group.title} ${label}">`}
      `;
      const select = row.querySelector('.editor-select');
      const range = row.querySelector('.editor-range');
      const number = row.querySelector('.editor-number');
      const color = row.querySelector('.editor-color');
      if (options) {
        const commitOption = (value) => {
          const next = structuredClone(getTuning());
          setAtPath(next, path, value);
          setTuning(next, { path });
          select.value = value;
          sync();
        };
        select.addEventListener('change', () => commitOption(select.value));
        inputs.set(path, { row, select, step, options });
        section.append(row);
        continue;
      }
      const commit = (rawValue) => {
        const value = Math.min(max, Math.max(min, Number(rawValue)));
        if (!Number.isFinite(value)) return;
        const next = structuredClone(getTuning());
        setAtPath(next, path, value);
        setTuning(next, { path });
        if (range) range.value = String(value);
        number.value = formatValue(value, step);
        if (color) color.value = formatColor(value);
      };
      range?.addEventListener('input', () => commit(range.value));
      number.addEventListener(isColor ? 'change' : 'input', () => commit(number.value));
      color?.addEventListener('change', () => commit(parseInt(color.value.slice(1), 16)));
      inputs.set(path, { row, range, number, color, step });
      section.append(row);
    }
    fieldsRoot.append(section);
  }

  function updatePassengerMaterialVisibility(tuning) {
    const mode = tuning.passengerMaterial?.mode ?? 'unityTexture';
    for (const [path, controls] of inputs) {
      if (path.startsWith('passengerMaterial.colors.')) {
        controls.row.hidden = mode === 'solidColor';
      } else if (path.startsWith('passengerMaterial.solidColors.')) {
        controls.row.hidden = mode !== 'solidColor';
      } else if (path === 'passengerMaterial.baseColorStrength') {
        controls.row.hidden = mode === 'solidColor';
      }
    }
  }

  function updateConveyorLayoutVisibility(tuning) {
    const selected = tuning.conveyorLayout?.selected ?? 'dualQueue2';
    for (const section of fieldsRoot.querySelectorAll('[data-conveyor-layout]')) {
      section.hidden = section.dataset.conveyorLayout !== selected;
    }
  }

  function sync() {
    const tuning = getTuning();
    for (const [path, controls] of inputs) {
      const value = getAtPath(tuning, path);
      if (controls.select) {
        controls.select.value = value;
        continue;
      }
      if (controls.range) controls.range.value = String(value);
      controls.number.value = formatValue(value, controls.step);
      if (controls.color) controls.color.value = formatColor(value);
    }
    updatePassengerMaterialVisibility(tuning);
    updateConveyorLayoutVisibility(tuning);
  }

  const toggle = root.querySelector('.editor-toggle');
  const setCollapsed = (collapsed) => {
    root.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '\u8c03\u8282' : '\u00d7';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '\u5c55\u5f00\u573a\u666f\u7f16\u8f91\u5668' : '\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668');
  };
  toggle.addEventListener('click', () => setCollapsed(!root.classList.contains('is-collapsed')));
  root.querySelector('.editor-reset').addEventListener('click', () => {
    clearSavedTuning();
    setTuning(structuredClone(defaults));
    sync();
  });

  if (matchMedia('(max-width: 760px)').matches) setCollapsed(true);
  sync();
  return { sync, setCollapsed };
}
