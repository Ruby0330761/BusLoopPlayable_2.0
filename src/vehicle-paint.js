import * as THREE from 'three';

// The three ordinary FBXs place each surface inside a flat palette swatch.
// Resolve its ID once per template; all vehicles then share the geometry.
export function vehicleSwatchIndex(u, v) {
  const column = Math.floor(u * 12);
  const y = (1 - v) * 512;
  switch (column) {
    case 0: return y < 363 ? 0 : y < 406 ? 1 : 2;
    case 1: return y < 406 ? 3 : 4;
    case 2: return y < 346 ? 5 : 6;
    case 3: return y < 406 ? 7 : 8;
    case 4: return 9;
    case 5:
      if (y < 320) return u * 512 < 222 ? 14 : 15;
      return y < 406 ? 10 : 11;
    case 6: return y < 406 ? 12 : 13;
    default: throw new RangeError(`Unsupported ordinary vehicle paint UV: ${u}, ${v}`);
  }
}

export function attachVehicleSwatches(geometry) {
  const uv = geometry.getAttribute('uv');
  const ids = Uint8Array.from({ length: uv.count }, (_, i) => vehicleSwatchIndex(uv.getX(i), uv.getY(i)));
  geometry.setAttribute('vehicleSwatch', new THREE.Uint8BufferAttribute(ids, 1));
}

export function createVehiclePaintMaterial(surfaceColors) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0 });
  const colors = surfaceColors.map(css => new THREE.Color(css));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.vehiclePaint = { value: colors };
    shader.vertexShader = `attribute float vehicleSwatch;
uniform vec3 vehiclePaint[16];
varying vec3 vVehiclePaint;
` + shader.vertexShader.replace('#include <color_vertex>',
      '#include <color_vertex>\nvVehiclePaint = vehiclePaint[int(vehicleSwatch)];');
    shader.fragmentShader = 'varying vec3 vVehiclePaint;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vVehiclePaint;'
    );
  };
  material.customProgramCacheKey = () => 'ordinary-vehicle-swatches-v1';
  return material;
}
