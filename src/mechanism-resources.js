const MECHANISM_ROOT = '/assets/unity/mechanisms';

export const MECHANISM_TYPES = Object.freeze({
  ordinaryConveyor: 'ordinaryConveyor',
  entryBanner: 'entryBanner',
  passengerEmoji: 'passengerEmoji',
  randomPlayableAudio: 'randomPlayableAudio',
  spatialConveyor: 'spatialConveyor',
  luxuryVehicle: 'luxuryVehicle',
  ambulance: 'ambulance',
  fireTruck: 'fireTruck',
  policeCar: 'policeCar',
  turnVehicle: 'turnVehicle',
  hiddenVehicle: 'hiddenVehicle',
  garage: 'garage',
  vehicleTransportBelt: 'vehicleTransportBelt'
});

export const MECHANISM_TYPE_ORDER = Object.freeze([
  MECHANISM_TYPES.ordinaryConveyor,
  MECHANISM_TYPES.entryBanner,
  MECHANISM_TYPES.passengerEmoji,
  MECHANISM_TYPES.randomPlayableAudio,
  MECHANISM_TYPES.spatialConveyor,
  MECHANISM_TYPES.luxuryVehicle,
  MECHANISM_TYPES.ambulance,
  MECHANISM_TYPES.fireTruck,
  MECHANISM_TYPES.policeCar,
  MECHANISM_TYPES.turnVehicle,
  MECHANISM_TYPES.hiddenVehicle,
  MECHANISM_TYPES.garage,
  MECHANISM_TYPES.vehicleTransportBelt
]);

export const MECHANISM_RESOURCE_MANIFEST = /* @__PURE__ */ Object.freeze({
  [MECHANISM_TYPES.ordinaryConveyor]: /* @__PURE__ */ Object.freeze([
    '/assets/unity/conveyors/Loop_02_q80.webp',
    '/assets/unity/conveyors/Loop_03_q80.webp',
    '/assets/unity/conveyors/Loop_04_q80.webp',
    '/assets/unity/conveyors/Loop_06_q80.webp'
  ]),
  [MECHANISM_TYPES.spatialConveyor]: /* @__PURE__ */ Object.freeze([]),
  [MECHANISM_TYPES.entryBanner]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/entry-banner/sprites/Main_EntryBanner_PurpleArrows.png`,
    `${MECHANISM_ROOT}/entry-banner/sprites/Main_EntryBanner_RedArrows.png`,
    `${MECHANISM_ROOT}/entry-banner/sprites/Hard.png`,
    `${MECHANISM_ROOT}/entry-banner/sprites/HardBg.png`,
    `${MECHANISM_ROOT}/entry-banner/sprites/SuperHard.png`,
    `${MECHANISM_ROOT}/entry-banner/sprites/SuperHardBg.png`
  ]),
  [MECHANISM_TYPES.luxuryVehicle]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/luxury-vehicle/models/Luxury_001.fbx.bin`,
    `${MECHANISM_ROOT}/luxury-vehicle/models/Idle_wealthy.fbx.bin`,
    `${MECHANISM_ROOT}/luxury-vehicle/models/Idle_wealthy_vatmesh.bin`,
    `${MECHANISM_ROOT}/luxury-vehicle/models/Idle_wealthy_anim_map.vatq`,
    `${MECHANISM_ROOT}/luxury-vehicle/animations/wealthy-passenger.json`,
    `${MECHANISM_ROOT}/luxury-vehicle/textures/Luxury.png`,
    `${MECHANISM_ROOT}/luxury-vehicle/textures/Luxury_metal.png`,
    `${MECHANISM_ROOT}/luxury-vehicle/textures/Idle_wealthy.png`,
    `${MECHANISM_ROOT}/luxury-vehicle/textures/Idle_wealthy_cloth.png`,
    `${MECHANISM_ROOT}/luxury-vehicle/textures/count_limousine.png`,
    `${MECHANISM_ROOT}/luxury-vehicle/textures/Car_seat_shadow_vip.png`
  ]),
  [MECHANISM_TYPES.ambulance]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/ambulance/models/Ambulance_001.fbx`,
    `${MECHANISM_ROOT}/ambulance/models/Idle_girl_rescuer.fbx`,
    `${MECHANISM_ROOT}/ambulance/models/Idle_girl_rescuer_vatmesh.bin`,
    `${MECHANISM_ROOT}/ambulance/models/Idle_girl_rescuer_anim_map.vatq`,
    `${MECHANISM_ROOT}/ambulance/textures/Ambulance.png`,
    `${MECHANISM_ROOT}/ambulance/textures/Idle_girl_rescuer.png`,
    `${MECHANISM_ROOT}/ambulance/textures/Main_Gamepanel_BubbleLove.png`,
    `${MECHANISM_ROOT}/ambulance/audio/ambulance_countdown_V2.wav`
  ]),
  [MECHANISM_TYPES.passengerEmoji]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/passenger-emoji/angry-emoji-sheet.webp`
  ]),
  [MECHANISM_TYPES.randomPlayableAudio]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/random-playable-audio/audio/police-ring.bin`,
    `${MECHANISM_ROOT}/random-playable-audio/audio/move.mp3`,
    `${MECHANISM_ROOT}/random-playable-audio/audio/hey-move-it.mp3`
  ]),
  [MECHANISM_TYPES.fireTruck]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/fire-truck/models/Fire Engine.fbx`,
    `${MECHANISM_ROOT}/fire-truck/models/Idle_boy_firefighter_vatmesh.bin`,
    `${MECHANISM_ROOT}/fire-truck/models/Idle_boy_firefighter_anim_map.vatq`,
    `${MECHANISM_ROOT}/fire-truck/textures/Fire Engine.png`,
    `${MECHANISM_ROOT}/fire-truck/textures/Car_firetruck_shadow.png`,
    `${MECHANISM_ROOT}/fire-truck/textures/Idle_boy_firefighter.png`,
    `${MECHANISM_ROOT}/fire-truck/ui/Fire_01.webp`,
    `${MECHANISM_ROOT}/fire-truck/ui/Warning_01.webp`,
    `${MECHANISM_ROOT}/fire-truck/ui/Warning_02.webp`,
    `${MECHANISM_ROOT}/fire-truck/ui/Guide_FireTruck_TimeBg.png`,
    `${MECHANISM_ROOT}/fire-truck/ui/Main_Prop_Icon_Truck.png`,
    `${MECHANISM_ROOT}/fire-truck/ui/Main_Prop_TimeBg.png`,
    `${MECHANISM_ROOT}/fire-truck/ui/Main_Prop_Icon_Clock.png`,
    `${MECHANISM_ROOT}/fire-truck/audio/firetruck_1.bin`,
    `${MECHANISM_ROOT}/fire-truck/audio/firetruck_3.bin`
  ]),
  [MECHANISM_TYPES.policeCar]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/police-car/models/Police Car_001.fbx`,
    `${MECHANISM_ROOT}/police-car/models/Idle_boy_police_vatmesh.bin`,
    `${MECHANISM_ROOT}/police-car/models/Idle_boy_police_anim_map.vatq`,
    `${MECHANISM_ROOT}/police-car/textures/Police Car.png`,
    `${MECHANISM_ROOT}/police-car/textures/Idle_boy_police.png`,
    `${MECHANISM_ROOT}/police-car/audio/police_siren.bin`
  ]),
  [MECHANISM_TYPES.turnVehicle]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/turn-vehicle/models/Arrow_02.fbx.bin`,
    `${MECHANISM_ROOT}/turn-vehicle/audio/guidemove.bin`
  ]),
  [MECHANISM_TYPES.hiddenVehicle]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/hidden-vehicle/models/questionmark.fbx.bin`,
    `${MECHANISM_ROOT}/hidden-vehicle/models/car_01_c.fbx.bin`,
    `${MECHANISM_ROOT}/hidden-vehicle/models/van_01_c.fbx.bin`,
    `${MECHANISM_ROOT}/hidden-vehicle/models/bus_01_c.fbx.bin`,
    `${MECHANISM_ROOT}/hidden-vehicle/textures/question_mark.png`,
    `${MECHANISM_ROOT}/hidden-vehicle/audio/hidden_reveal.bin`
  ]),
  [MECHANISM_TYPES.garage]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/garage/models/Garage_Truck_01.fbx`,
    `${MECHANISM_ROOT}/garage/models/Garage_Truck_01_FakeShadow.fbx`,
    `${MECHANISM_ROOT}/garage/textures/Garage_Truck_01.png`,
    `${MECHANISM_ROOT}/garage/textures/Garage_Truck_01_FakeShadow.png`,
    `${MECHANISM_ROOT}/garage/audio/garage_out.wav`,
    `${MECHANISM_ROOT}/garage/audio/garage_clear.wav`
  ]),
  [MECHANISM_TYPES.vehicleTransportBelt]: /* @__PURE__ */ Object.freeze([
    `${MECHANISM_ROOT}/vehicle-transport-belt/models/plane_conveyor.fbx`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/models/plane_conveyor_arrow.fbx`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_arrow.png`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_belt.png`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_DoorLeft.png`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_DoorRight.png`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_Leftside.png`,
    `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_Rightside.png`
  ])
});

export const MECHANISM_ASSETS = /* @__PURE__ */ Object.freeze({
  entryBanner: Object.freeze({
    hardTitle: `${MECHANISM_ROOT}/entry-banner/sprites/Hard.png`,
    hardBackground: `${MECHANISM_ROOT}/entry-banner/sprites/HardBg.png`,
    superHardTitle: `${MECHANISM_ROOT}/entry-banner/sprites/SuperHard.png`,
    superHardBackground: `${MECHANISM_ROOT}/entry-banner/sprites/SuperHardBg.png`,
    purpleArrows: `${MECHANISM_ROOT}/entry-banner/sprites/Main_EntryBanner_PurpleArrows.png`,
    redArrows: `${MECHANISM_ROOT}/entry-banner/sprites/Main_EntryBanner_RedArrows.png`
  }),
  luxuryVehicle: Object.freeze({
    vehicleModel: `${MECHANISM_ROOT}/luxury-vehicle/models/Luxury_001.fbx.bin`,
    passengerModel: `${MECHANISM_ROOT}/luxury-vehicle/models/Idle_wealthy.fbx.bin`,
    passengerVatMesh: `${MECHANISM_ROOT}/luxury-vehicle/models/Idle_wealthy_vatmesh.bin`,
    passengerVatTexture: `${MECHANISM_ROOT}/luxury-vehicle/models/Idle_wealthy_anim_map.vatq`,
    animation: `${MECHANISM_ROOT}/luxury-vehicle/animations/wealthy-passenger.json`,
    vehicleTexture: `${MECHANISM_ROOT}/luxury-vehicle/textures/Luxury.png`,
    vehicleMetalTexture: `${MECHANISM_ROOT}/luxury-vehicle/textures/Luxury_metal.png`,
    passengerTexture: `${MECHANISM_ROOT}/luxury-vehicle/textures/Idle_wealthy.png`,
    passengerClothTexture: `${MECHANISM_ROOT}/luxury-vehicle/textures/Idle_wealthy_cloth.png`,
    seatCountBoard: `${MECHANISM_ROOT}/luxury-vehicle/textures/count_limousine.png`
  }),
  ambulance: Object.freeze({
    vehicleModel: `${MECHANISM_ROOT}/ambulance/models/Ambulance_001.fbx`,
    passengerVatMesh: `${MECHANISM_ROOT}/ambulance/models/Idle_girl_rescuer_vatmesh.bin`,
    passengerVatTexture: `${MECHANISM_ROOT}/ambulance/models/Idle_girl_rescuer_anim_map.vatq`,
    vehicleTexture: `${MECHANISM_ROOT}/ambulance/textures/Ambulance.png`,
    passengerTexture: `${MECHANISM_ROOT}/ambulance/textures/Idle_girl_rescuer.png`,
    stepBubble: `${MECHANISM_ROOT}/ambulance/textures/Main_Gamepanel_BubbleLove.png`,
    audio: `${MECHANISM_ROOT}/ambulance/audio/ambulance_countdown_V2.wav`
  }),
  passengerEmoji: Object.freeze({
    angrySheet: `${MECHANISM_ROOT}/passenger-emoji/angry-emoji-sheet.webp`
  }),
  randomPlayableAudio: Object.freeze({
    policeRing: `${MECHANISM_ROOT}/random-playable-audio/audio/police-ring.bin`,
    move: `${MECHANISM_ROOT}/random-playable-audio/audio/move.mp3`,
    heyMoveIt: `${MECHANISM_ROOT}/random-playable-audio/audio/hey-move-it.mp3`
  }),
  fireTruck: Object.freeze({
    vehicleModel: `${MECHANISM_ROOT}/fire-truck/models/Fire Engine.fbx`,
    passengerVatMesh: `${MECHANISM_ROOT}/fire-truck/models/Idle_boy_firefighter_vatmesh.bin`,
    passengerVatTexture: `${MECHANISM_ROOT}/fire-truck/models/Idle_boy_firefighter_anim_map.vatq`,
    vehicleTexture: `${MECHANISM_ROOT}/fire-truck/textures/Fire Engine.png`,
    vehicleShadowTexture: `${MECHANISM_ROOT}/fire-truck/textures/Car_firetruck_shadow.png`,
    passengerTexture: `${MECHANISM_ROOT}/fire-truck/textures/Idle_boy_firefighter.png`,
    fireTexture: `${MECHANISM_ROOT}/fire-truck/ui/Fire_01.webp`,
    warningTexture: `${MECHANISM_ROOT}/fire-truck/ui/Warning_01.webp`,
    warningTextureStrong: `${MECHANISM_ROOT}/fire-truck/ui/Warning_02.webp`,
    timerFrameTexture: `${MECHANISM_ROOT}/fire-truck/ui/Guide_FireTruck_TimeBg.png`,
    timerVehicleTexture: `${MECHANISM_ROOT}/fire-truck/ui/Main_Prop_Icon_Truck.png`,
    timerReadoutTexture: `${MECHANISM_ROOT}/fire-truck/ui/Main_Prop_TimeBg.png`,
    timerClockTexture: `${MECHANISM_ROOT}/fire-truck/ui/Main_Prop_Icon_Clock.png`,
    startAudio: `${MECHANISM_ROOT}/fire-truck/audio/firetruck_1.bin`,
    failAudio: `${MECHANISM_ROOT}/fire-truck/audio/firetruck_3.bin`
  }),
  policeCar: Object.freeze({
    vehicleModel: `${MECHANISM_ROOT}/police-car/models/Police Car_001.fbx`,
    passengerVatMesh: `${MECHANISM_ROOT}/police-car/models/Idle_boy_police_vatmesh.bin`,
    passengerVatTexture: `${MECHANISM_ROOT}/police-car/models/Idle_boy_police_anim_map.vatq`,
    vehicleTexture: `${MECHANISM_ROOT}/police-car/textures/Police Car.png`,
    passengerTexture: `${MECHANISM_ROOT}/police-car/textures/Idle_boy_police.png`,
    audio: `${MECHANISM_ROOT}/police-car/audio/police_siren.bin`
  }),
  turnVehicle: Object.freeze({
    arrow: `${MECHANISM_ROOT}/turn-vehicle/models/Arrow_02.fbx.bin`,
    audio: `${MECHANISM_ROOT}/turn-vehicle/audio/guidemove.bin`
  }),
  hiddenVehicle: Object.freeze({
    questionMark: `${MECHANISM_ROOT}/hidden-vehicle/models/questionmark.fbx.bin`,
    questionTexture: `${MECHANISM_ROOT}/hidden-vehicle/textures/question_mark.png`,
    audio: `${MECHANISM_ROOT}/hidden-vehicle/audio/hidden_reveal.bin`,
    vehicleBySeats: Object.freeze({
      4: `${MECHANISM_ROOT}/hidden-vehicle/models/car_01_c.fbx.bin`,
      6: `${MECHANISM_ROOT}/hidden-vehicle/models/van_01_c.fbx.bin`,
      10: `${MECHANISM_ROOT}/hidden-vehicle/models/bus_01_c.fbx.bin`
    })
  }),
  garage: Object.freeze({
    model: `${MECHANISM_ROOT}/garage/models/Garage_Truck_01.fbx`,
    texture: `${MECHANISM_ROOT}/garage/textures/Garage_Truck_01.png`,
    shadowModel: `${MECHANISM_ROOT}/garage/models/Garage_Truck_01_FakeShadow.fbx`,
    shadowTexture: `${MECHANISM_ROOT}/garage/textures/Garage_Truck_01_FakeShadow.png`,
    outAudio: `${MECHANISM_ROOT}/garage/audio/garage_out.wav`,
    clearAudio: `${MECHANISM_ROOT}/garage/audio/garage_clear.wav`
  }),
  vehicleTransportBelt: Object.freeze({
    beltModel: `${MECHANISM_ROOT}/vehicle-transport-belt/models/plane_conveyor.fbx`,
    arrowModel: `${MECHANISM_ROOT}/vehicle-transport-belt/models/plane_conveyor_arrow.fbx`,
    beltTexture: `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_belt.png`,
    arrowTexture: `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_arrow.png`,
    doorLeftTexture: `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_DoorLeft.png`,
    doorRightTexture: `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_DoorRight.png`,
    leftSideTexture: `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_Leftside.png`,
    rightSideTexture: `${MECHANISM_ROOT}/vehicle-transport-belt/textures/plane_conveyor_build_Rightside.png`
  })
});

export const BASE_RUNTIME_ASSET_PATHS = /* @__PURE__ */ Object.freeze([
  '/assets/applovin/icon_q75.jpg',
  '/assets/applovin/main-guide-hand_q80.webp',
  '/assets/main-loading-icon-small.png',
  '/assets/unity/fonts/Poppins-Bold.ttf',
  '/assets/unity/ui/Main_Prop_GreenBtn.png'
]);

function addType(types, type) {
  if (!types.includes(type)) types.push(type);
}

function isGarageContainer(container) {
  return container?.type === 2
    || String(container?.type ?? '').trim().toLowerCase() === 'garage';
}

function isVehicleTransportContainer(container) {
  const type = String(container?.type ?? '').trim().toLowerCase();
  return container?.type === 3 || type === 'conveyorbelt' || type === 'conveyor-belt';
}

export function deriveLevelMechanics(level = {}) {
  const vehicles = Array.isArray(level.vehicles) ? level.vehicles : [];
  const containers = Array.isArray(level.containers) ? level.containers : [];
  const vehicleAmbulances = Array.isArray(level.vehicleAmbulances) ? level.vehicleAmbulances : [];
  const vehicleFiretrucks = Array.isArray(level.vehicleFiretrucks) ? level.vehicleFiretrucks : [];
  const conveyorBelts = Array.isArray(level.conveyorBelts) ? level.conveyorBelts : [];
  const counts = {
    luxuryVehicle: vehicles.filter((vehicle) => vehicle?.isLuxury || vehicle?.colorIndex === 15).length,
    ambulance: vehicles.filter((vehicle) => Number.isInteger(vehicle?.ambulanceStepLimit)).length
      || vehicleAmbulances.length,
    fireTruck: vehicles.filter((vehicle) => Number.isInteger(vehicle?.firetruckTimeLimit)
      || vehicle?.isFireTruck || vehicle?.colorIndex === 12).length
      || vehicleFiretrucks.length,
    policeCar: vehicles.filter((vehicle) => vehicle?.isPolice || vehicle?.colorIndex === 11).length,
    turnVehicle: vehicles.filter((vehicle) => vehicle?.isTurnVehicle).length,
    hiddenVehicle: vehicles.filter((vehicle) => vehicle?.isHidden).length,
    garage: containers.filter(isGarageContainer).length,
    vehicleTransportBelt: containers.filter(isVehicleTransportContainer).length
      || conveyorBelts.length
  };
  const specialTypes = [];
  if (counts.luxuryVehicle > 0) addType(specialTypes, MECHANISM_TYPES.luxuryVehicle);
  if (counts.ambulance > 0) addType(specialTypes, MECHANISM_TYPES.ambulance);
  if (counts.fireTruck > 0) addType(specialTypes, MECHANISM_TYPES.fireTruck);
  if (counts.policeCar > 0) addType(specialTypes, MECHANISM_TYPES.policeCar);
  if (counts.turnVehicle > 0) addType(specialTypes, MECHANISM_TYPES.turnVehicle);
  if (counts.hiddenVehicle > 0) addType(specialTypes, MECHANISM_TYPES.hiddenVehicle);
  if (counts.garage > 0) addType(specialTypes, MECHANISM_TYPES.garage);
  if (counts.vehicleTransportBelt > 0) addType(specialTypes, MECHANISM_TYPES.vehicleTransportBelt);
  return {
    isMechanicLevel: specialTypes.length > 0,
    types: Object.freeze([MECHANISM_TYPES.ordinaryConveyor, ...specialTypes]),
    counts: Object.freeze(counts)
  };
}

export function getMechanismTypesForLevels(
  levels = [],
  {
    spatialSelection = null,
    entryBannerEnabled = false,
    passengerEmojiEnabled = false,
    randomPlayableAudioEnabled = false
  } = {}
) {
  const types = [];
  if (entryBannerEnabled) addType(types, MECHANISM_TYPES.entryBanner);
  if (passengerEmojiEnabled) addType(types, MECHANISM_TYPES.passengerEmoji);
  if (randomPlayableAudioEnabled) addType(types, MECHANISM_TYPES.randomPlayableAudio);
  for (const level of levels) {
    const metadata = level?.mechanics ?? deriveLevelMechanics(level);
    for (const type of metadata.types ?? []) addType(types, type);
  }
  if (typeof spatialSelection === 'string' && spatialSelection.startsWith('spatial:')) {
    addType(types, MECHANISM_TYPES.spatialConveyor);
  }
  return MECHANISM_TYPE_ORDER.filter((type) => types.includes(type));
}

export function getMechanismResourcePaths(types = []) {
  return [...new Set(types.flatMap((type) => MECHANISM_RESOURCE_MANIFEST[type] ?? []))];
}
