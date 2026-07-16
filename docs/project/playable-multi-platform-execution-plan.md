# Playable Multi-Platform Execution Plan

## Current implementation status

- Editor/AppLovin baseline prototype continues to use Three.js runtime particles for vehicle effects.
- Latest effect parity work: Effect_Ribbon departure burst now separates ParticleRibbon and ParticleSmoke, including Ribbon_01 3x3 atlas sampling.
- Effect_Ribbon movement now has per-particle speedOverLifetime and moveRange controls for Unity parity tuning.
- Before platform packaging, perform manual visual comparison against Unity reference for:
  - ribbon frame variety,
  - smoke density,
  - initial particle size,
  - fade-out speed,
  - movement range after spawn,
  - speed curve / deceleration over lifetime,
  - direction/position relative to departing vehicle.