# Playable Resource Status

## Conveyor layouts

| Resource | Status | Notes |
| --- | --- | --- |
| `public/assets/unity/conveyors/Loop_02_q80.webp` | wired | `GameSceneDualQueue2.prefab`; default editor/runtime layout. |
| `public/assets/unity/conveyors/Loop_03_q80.webp` | wired | `GameSceneDualQueue3.prefab`; paired with its authored closed/queue splines. |
| `public/assets/unity/conveyors/Loop_06_q80.webp` | wired | `GameSceneDualQueue5.prefab` via nested `ConveyorBelt6.prefab`; paired with merged authored splines. |
| `public/assets/unity/conveyors/Loop_04_q80.webp` | wired | `GameSceneDualQueue10.prefab`; paired with its authored closed/queue splines. |

## Effects

| Resource | Status | Notes |
| --- | --- | --- |
| public/assets/unity/effects/Ribbon_01.png | wired | Used by ParticleRibbon as a 3x3 / 9-frame atlas. |
| public/assets/unity/effects/Smoke_08.png | wired | Used by Effect_Ribbon ParticleSmoke. |
| public/assets/unity/effects/Round_01.png | wired | Used by passenger boarding smoke, Effect_Hit ParticleHit, and Effect_SmokeTrail ParticleTrail. |
| public/assets/unity/effects/Circle_01.png | wired | Used by Effect_Hit ParticleHit_2. |
| public/assets/unity/effects/Round_02.png | wired | Used by Effect_Hit ParticleHit_1. |

## Audio

| Resource | Status | Notes |
| --- | --- | --- |
| public/assets/unity/audio/bus_hit_V5.wav | wired | `AudioName.bus_hit`, played on vehicle collision contact. |
| public/assets/unity/audio/passenger_up_01.wav | wired | `AudioName.passenger_up` random clip, played when a visual passenger reaches the vehicle. |
| public/assets/unity/audio/passenger_up_02.wav | wired | `AudioName.passenger_up` random clip, played when a visual passenger reaches the vehicle. |
| public/assets/unity/audio/passenger_up_03.wav | wired | `AudioName.passenger_up` random clip, played when a visual passenger reaches the vehicle. |
| public/assets/unity/audio/bus_full.wav | wired | `AudioName.bus_full`, played when a full vehicle starts leaving the station. |

## Open resource/config gaps

- Exact Unity Inspector numeric values for Effect_Ribbon ParticleRibbon and ParticleSmoke initial size / fade-out speed / speed-over-lifetime / movement range can still be replaced if supplied. Current implementation preserves these as explicit config fields rather than burying them inside shared update math.
