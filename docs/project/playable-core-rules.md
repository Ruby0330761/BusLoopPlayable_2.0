# Playable Core Rules

## Effect_Ribbon vehicle departure effect

- The departure effect is attached to parking spot vacancy: when an occupied spot becomes empty, spawn Effect_Ribbon once for that spot.
- Effect_Ribbon contains two logical particles under the same node:
  - ParticleRibbon
  - ParticleSmoke
- ParticleRibbon must not render Ribbon_01 as one whole sprite. Ribbon_01 is a 3x3 atlas containing 9 smaller frames; runtime particles should select atlas frames via texture repeat/offset.
- ParticleRibbon and ParticleSmoke particle settings should keep these authored fields explicit in code so future Unity Inspector values can be patched directly:
  - initialSize
  - fadeOutSpeed
  - sizeOverLifetime
  - speedOverLifetime
  - moveRange
- Particle movement should be driven by the particle's normalized lifetime speed curve and clamped by its configured movement range from spawn origin.

## Web editor exposure

- These Effect_Ribbon movement fields must be exposed in the web scene editor for both ParticleRibbon and ParticleSmoke:
  - moveRange
  - speedStart
  - speedMidTime
  - speedMid
  - speedEnd