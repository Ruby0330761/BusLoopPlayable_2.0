# Playable Resource Status

## PNG compression pass

On 2026-09-08, 62 byte-unique TinyPNG results replaced 112 existing paths across `public`, generated `dist`, spatial-import support, and the explicitly listed artifacts. Dimensions, transparent-pixel behavior, and replacement hashes were verified before the temporary compressed files and ZIPs were removed. Five PNGs rejected by TinyPNG were losslessly re-encoded with pixel equality verified before compression. The requested police textures `Idle_boy_police.png`, `WarningLamp.png`, and `Police_Car.png` were not present at their listed paths and were not replaced.

## FBX/VAT delivery compression

- Raw FBX files, VAT mesh binaries, and the default half-float VAT map are now gzip-compressed in place and decoded by `src/scene-view.js` before parsing.
- Existing `*.fbx.bin` and `*.vatq` resources remain in their established formats; no VAT quantization was introduced in this pass.
- The 20-file rollback set, original hashes, compressed hashes, and restore script are under `artifacts/backups/fbx-vat-before-20260908-095053/`.

## Backgrounds

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/applovin/textures/BG01_split01_q60.jpg` | wired | Editor option `BG01 \u51ac\u5b63`; current `level10-winter.html` and `index.html` embed this background only. |
| `public/assets/applovin/textures/BG02_split01_winter.png` | source | Supplied 2100x3382 BG02 winter source; preserved unchanged and excluded unless selected directly. |
| `public/assets/applovin/textures/BG02_split01_winter_q60.jpg` | wired | Editor option `BG02 \u51ac\u5b63`; 140,721-byte JPEG quality-60 delivery derivative. |
| `public/assets/applovin/textures/BG02_split01_summer_q60.jpg` | wired | Editor option `BG02 \u590f\u5b63`; excluded from both current named Level10 packages. |
| `public/assets/applovin/textures/BG01_split01_Sakura.png` | source | Supplied 2100x3382 Sakura source; preserved unchanged and excluded from production packages. |
| `public/assets/applovin/textures/BG01_split01_Sakura_q60.jpg` | wired | Editor option `BG01 \u6a31\u82b1`; 278,157-byte delivery derivative preserved alone in `level10-sakura.html` and excluded from the winter package. |

## Vehicle visuals

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/models/Arrow_01.fbx` | wired/packed | Current ordinary vehicle direction marker, refreshed from Unity `Assets/BusJam/Game/Models/Car_0307/Arrow_01.fbx` and stored as gzip bytes in place (`126,928 -> 18,056` bytes); turn vehicles continue to use their dedicated `Arrow_02` model. |

## Conveyor layouts

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/conveyors/Loop_02_q80.webp` | wired | `GameSceneDualQueue2.prefab`; default editor/runtime layout. |
| `public/assets/unity/conveyors/Loop_03_q80.webp` | wired | `GameSceneDualQueue3.prefab`; paired with its authored closed/queue splines. |
| `public/assets/unity/conveyors/Loop_06_q80.webp` | wired | `GameSceneDualQueue5.prefab` via nested `ConveyorBelt6.prefab`; paired with merged authored splines. |
| `public/assets/unity/conveyors/Loop_04_q80.webp` | wired | `GameSceneDualQueue10.prefab`; paired with its authored closed/queue splines. |
| `tools/spatial-conveyor-import-support/bus-loop-spatial-v1/Loop_initial.png` | wired | TinyPNG-compressed 4x162 spatial road segment, 242 bytes, SHA-256 `069E9BC6EC2AECFAF49B6ED0ED3BFB7CABF62059267CD52D96D3B6269C2F8669`; embedded into newly imported spatial packages. |
| `tools/spatial-conveyor-import-support/bus-loop-spatial-v1/Loop_exit.png` | wired | TinyPNG-compressed 214x89 spatial exit overlay, 3,963 bytes, SHA-256 `9E9B7EAE27D80C32B64A90BA38CAA0146FF13B872246C86F79F1BB98EA7FF7FB`; embedded into newly imported spatial packages. |
| `artifacts/spatial-conveyors/ConveyorBeltShape.json` | wired | Preserved at 56 authored points and 49,632 bytes with the current compressed spatial textures embedded as PNG data URLs. |

## Mechanism resource ownership and packaging

Mechanism resources are now grouped under `public/assets/unity/mechanisms/<mechanism>/` and are selected by the production level metadata. Ordinary conveyor images remain under `public/assets/unity/conveyors/`; spatial conveyor textures stay embedded in `artifacts/spatial-conveyors/*.json`.

The importer/extractor writes `level.mechanics` with `isMechanicLevel`, ordered `types`, and per-type `counts`. The AppLovin packager reads the active production session, adds only the selected mechanism manifest entries, and replaces omitted asset references with tiny placeholders. This preserves the single-file runtime contract while preventing unused mechanism binaries from entering the HTML.

Final validation used `level28` (ordinary conveyor + spatial conveyor + turn vehicle): `4,598,228` bytes (`4.385 MiB`), below the `5,000,000` byte limit. The selected mechanism whitelist and omitted mechanism resources both passed static verification.

## Vehicle conveyor-belt mechanism

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/mechanisms/vehicle-transport-belt/models/plane_conveyor.fbx` | wired | Current Unity vehicle-container belt model; loaded only when the active level contains type 3 conveyor vehicles. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/models/plane_conveyor_arrow.fbx` | wired | Current Unity belt arrow model; its texture offset advances with the runtime belt speed. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_belt.png` | wired | Authored belt surface texture. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_arrow.png` | wired | Authored animated arrow texture. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_DoorLeft.png` | wired | Current Unity left end-cap overlay; visual-only and hidden with the belt. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_DoorRight.png` | wired | Current Unity right end-cap overlay; visual-only and hidden with the belt. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_Leftside.png` | wired | Current Unity left side overlay; visual-only and hidden with the belt. |
| `public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_Rightside.png` | wired | Current Unity right side overlay; visual-only and hidden with the belt. |
| `artifacts/unity-level-sources/level22.asset` | imported | Current Unity `Level_Escape_D/level22.asset` sample with one type 3 container and eight vehicles; no Unity project dependency at runtime. |

Conveyor vehicles now participate in the conveyor-specific collision context as live projected obstacles. The nearest forward overlapping vehicle is selected as the direct blocker; build overlays do not participate in collision.

## Ambulance

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/mechanisms/ambulance/models/Ambulance_001.fbx` | wired | Ambulance vehicle model, loaded only when the imported level contains ambulance configuration. |
| `public/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer.fbx` | retained | Unity source passenger model retained with the mechanism package. |
| `public/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer_vatmesh.bin` / `Idle_girl_rescuer_anim_map.vatq` | wired | Ambulance passenger VAT resources and authored move/idle clips. |
| `public/assets/unity/mechanisms/ambulance/textures/Ambulance.png` | wired | Ambulance vehicle texture. |
| `public/assets/unity/mechanisms/ambulance/textures/Idle_girl_rescuer.png` | wired | Ambulance passenger texture. |
| `public/assets/unity/mechanisms/ambulance/textures/Main_Gamepanel_BubbleLove.png` | wired | Ambulance step-limit board texture. |
| `public/assets/unity/mechanisms/ambulance/audio/ambulance_countdown_V2.wav` | wired | Ambulance countdown cue. |

## Turn vehicle

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/mechanisms/turn-vehicle/models/Arrow_02.fbx.bin` | wired | Dedicated turn-vehicle direction marker. |
| `public/assets/unity/mechanisms/turn-vehicle/audio/guidemove.bin` | wired | Turn-completion cue; loaded only when the level has turn vehicles. |

## Effects

| Resource | Status | Notes |
| --- | --- | --- |
| public/assets/unity/effects/Ribbon_01.png | wired | Used by ParticleRibbon as a 3x3 / 9-frame atlas. |
| public/assets/unity/effects/Smoke_08.png | wired | Used by Effect_Ribbon ParticleSmoke. |
| public/assets/unity/effects/Round_01.png | wired | Used by passenger boarding smoke, Effect_Hit ParticleHit, and Effect_SmokeTrail ParticleTrail. |
| public/assets/unity/effects/Circle_01.png | wired | Used by Effect_Hit ParticleHit_2. |
| public/assets/unity/effects/Round_02.png | wired | Used by Effect_Hit ParticleHit_1. |

## Hidden vehicles

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/mechanisms/hidden-vehicle/models/car_01_c.fbx.bin` | wired | Compressed four-seat hidden-body model; runtime uses a readable charcoal equivalent of Unity's untextured `bus_hidden` material and its meshes as the vehicle-sized hidden-state picking target. |
| `public/assets/unity/mechanisms/hidden-vehicle/models/van_01_c.fbx.bin` | wired | Compressed six-seat hidden-body model; runtime uses a readable charcoal equivalent of Unity's untextured `bus_hidden` material and its meshes as the vehicle-sized hidden-state picking target. |
| `public/assets/unity/mechanisms/hidden-vehicle/models/bus_01_c.fbx.bin` | wired | Compressed ten-seat hidden-body model; runtime uses a readable charcoal equivalent of Unity's untextured `bus_hidden` material and its meshes as the vehicle-sized hidden-state picking target. |
| `public/assets/unity/mechanisms/hidden-vehicle/models/questionmark.fbx.bin` | wired | Compressed Unity question-mark marker model. Runtime placement stays forward-facing but is moved inward from the hidden `bus_c_4/6/10` forward-edge anchor; marker meshes are visual-only and excluded from vehicle picking. |
| `public/assets/unity/mechanisms/hidden-vehicle/textures/question_mark.png` | wired | TinyPNG-compressed Unity question-mark marker texture, 680 bytes. |
| `public/assets/unity/mechanisms/hidden-vehicle/audio/hidden_reveal.bin` | wired | Unity `hidden_reveal.wav`, re-encoded as 16 kHz mono 16-bit PCM WAV; 84,924 -> 15,062 bytes. |

The Unity hidden-body animation clips and `Effect_Hidden_Bus_Out` feedback controller are represented by the playable runtime state/timing. The source Unity project is not required at runtime.

Unrevealed hidden vehicles remain interactive: blocked clicks enter the shared collision animation, and clear clicks start the reveal before the vehicle can be sent to a parking spot.

## Garage

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/mechanisms/garage/models/Garage_Truck_01.fbx` | wired | Current Unity skinned garage/truck model; playable applies the Prefab `Truck` child `Y=180°` correction and local-Z door hinges. |
| `public/assets/unity/mechanisms/garage/models/Garage_Truck_01_FakeShadow.fbx` | wired | Current Unity-authored fake shadow; receives the same `Y=180°` correction as the garage model. |
| `public/assets/unity/mechanisms/garage/textures/Garage_Truck_01.png` | wired | Main garage texture. |
| `public/assets/unity/mechanisms/garage/textures/Garage_Truck_01_FakeShadow.png` | wired | Transparent fake-shadow texture. |
| `public/assets/unity/mechanisms/garage/audio/garage_out.wav` | wired | Byte-identical to current Unity `garage_out V1.1.wav`; played at volume `0.7979798`. |
| `public/assets/unity/mechanisms/garage/audio/garage_clear.wav` | wired | Byte-identical to current Unity `garage_clear.wav`; played at volume `1`. |

All six resources are embedded in the AppLovin single HTML. They remain minimally transformed and uncompressed in this phase by user request. The garage visual and collision footprints share a `1.3x` enlargement factor. The imported garage FBX's `AmbientLight` is removed at load time so its Unity metadata cannot brighten the rest of the scene.

## Luxury vehicle and passenger

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/mechanisms/luxury-vehicle/models/Luxury_001.fbx.bin` | wired | Compressed limousine model; material groups use `Luxury.png` and `Luxury_metal.png` matcaps with the Unity-bright `4.1` response and the reference gold/deep-metal two-tone treatment. |
| `public/assets/unity/mechanisms/luxury-vehicle/models/Idle_wealthy.fbx.bin` | wired | Compressed original wealthy-passenger FBX; static topology avoids VAT duplicate-vertex tearing and preserves the two authored material groups. |
| `public/assets/unity/mechanisms/luxury-vehicle/textures/Luxury.png` | wired | Limousine body matcap. |
| `public/assets/unity/mechanisms/luxury-vehicle/textures/Luxury_metal.png` | wired | Limousine metal/glass matcap. |
| `public/assets/unity/mechanisms/luxury-vehicle/textures/Idle_wealthy.png` | wired | Wealthy-passenger body diffuse atlas. |
| `public/assets/unity/mechanisms/luxury-vehicle/textures/Idle_wealthy_cloth.png` | wired | Wealthy-passenger clothing matcap. |
| `public/assets/unity/mechanisms/luxury-vehicle/textures/count_limousine.png` | wired | Six-seat luxury count board. |
| `public/assets/unity/mechanisms/luxury-vehicle/models/Idle_wealthy_vatmesh.bin` / `Idle_wealthy_anim_map.vatq` | retained | Original packed VAT resources remain as extraction artifacts, but are not requested by the runtime; current luxury passenger rendering uses the skinned FBX path and extracted bone curves. |

## Audio

| Resource | Status | Notes |
| --- | --- | --- |
| public/assets/unity/audio/bus_hit_V5.wav | wired | `AudioName.bus_hit`, played on vehicle collision contact. |
| public/assets/unity/audio/passenger_up_01.wav | wired | `AudioName.passenger_up` random clip, played when a visual passenger reaches the vehicle. |
| public/assets/unity/audio/passenger_up_02.wav | wired | `AudioName.passenger_up` random clip, played when a visual passenger reaches the vehicle. |
| public/assets/unity/audio/passenger_up_03.wav | wired | `AudioName.passenger_up` random clip, played when a visual passenger reaches the vehicle. |
| public/assets/unity/audio/bus_full.wav | wired | `AudioName.bus_full`, played when a full vehicle starts leaving the station. |
| public/assets/unity/mechanisms/turn-vehicle/audio/guidemove.bin | wired | User-confirmed Unity `guidemove.wav` turn-completion cue, re-encoded as 16 kHz mono 16-bit PCM WAV; 8,632 bytes and inlined only for turn-vehicle completion events. |

## Open resource/config gaps

- Exact Unity Inspector numeric values for Effect_Ribbon ParticleRibbon and ParticleSmoke initial size / fade-out speed / speed-over-lifetime / movement range can still be replaced if supplied. Current implementation preserves these as explicit config fields rather than burying them inside shared update math.
