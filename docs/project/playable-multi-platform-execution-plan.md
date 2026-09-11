# Playable Multi-Platform Execution Plan

## Current implementation status

- The editor now exports one selected platform or all seven supported platforms through a package-only path. Existing assets are packaged as-is; no asset compression or resource optimization is performed during export.
- AppLovin, Unity Ads, and Moloco use single HTML; Google Ads, Meta, Mintegral, and TikTok use their required ZIP layouts. The all-platform ZIP contains those native deliverables unchanged.
- Ruleset `1.5.0` passes all `132` automated checks across `146` total checks; `14` manual platform gates remain. Official Preview, ad-console upload, and representative-device play are still required.

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
