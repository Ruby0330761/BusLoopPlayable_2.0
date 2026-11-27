import { DataUtils } from 'three';
import { gunzipSync, unzlibSync } from 'three/addons/libs/fflate.module.js';
import { LEVEL_1 } from './level-data.js';
import { decodeVatDeltas } from './passenger-vat-delta.js';

function decodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

function labelPreview(preview, label) {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(preview, caption);
  return figure;
}

function renderVatPreview(bytes, url) {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isPacked = url.endsWith('.vatq');
  const animation = LEVEL_1.assets.passengerAnimations;
  let width;
  let height;
  if (isPacked) {
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (bytes.length < 40 || magic !== 'VATQ' || view.getUint32(4, true) !== 1) return null;
    width = view.getUint32(8, true);
    height = view.getUint32(12, true);
  } else {
    if (url !== LEVEL_1.assets.models.passengerVatTexture) return null;
    width = animation?.textureWidth;
    height = animation?.textureHeight;
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_048_576) {
    return null;
  }
  const rgb = isPacked ? unzlibSync(bytes.subarray(40)) : null;
  if (!isPacked) {
    bytes = decodeVatDeltas(bytes, width, height);
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (isPacked ? rgb.length !== width * height * 3 : bytes.length !== width * height * 8) return null;
  const components = [0, 1, 2];
  const read = (pixel, component) => isPacked
    ? rgb[pixel * 3 + component]
    : DataUtils.fromHalfFloat(view.getUint16(pixel * 8 + component * 2, true));
  const min = isPacked ? [0, 0, 0] : [Infinity, Infinity, Infinity];
  const max = isPacked ? [255, 255, 255] : [-Infinity, -Infinity, -Infinity];
  if (!isPacked) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      for (const component of components) {
        const value = read(pixel, component);
        if (!Number.isFinite(value)) continue;
        min[component] = Math.min(min[component], value);
        max[component] = Math.max(max[component], value);
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (const component of components) {
      const range = max[component] - min[component];
      pixels.data[pixel * 4 + component] = range > 0
        ? 255 * (read(pixel, component) - min[component]) / range
        : 0;
    }
    pixels.data[pixel * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return labelPreview(canvas, '动画纹理通道预览 · ' + width + ' × ' + height);
}

async function renderModelPreview(bytes) {
  const [THREE, { FBXLoader }] = await Promise.all([
    import('three'), import('three/addons/loaders/FBXLoader.js')
  ]);
  const placeholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => placeholder);
  const object = new FBXLoader(manager).parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''
  );
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) throw new Error('Empty FBX geometry');
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(0.01, bounds.getSize(new THREE.Vector3()).length() / 2);
  const camera = new THREE.PerspectiveCamera(35, 320 / 180, radius / 100, radius * 10);
  camera.position.copy(center).add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(radius * 3.6));
  camera.lookAt(center);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef3f6');
  scene.overrideMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  scene.add(object);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  try {
    renderer.setSize(320, 180);
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
    return labelPreview(canvas, '模型几何预览');
  } finally {
    scene.overrideMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function renderExportBinaryPreview(buffer, url, kind) {
  if (kind === 'vat' || kind === 'model') {
    const bytes = decodeBytes(buffer);
    if (kind === 'model') return renderModelPreview(bytes);
    const texture = renderVatPreview(bytes, url);
    if (texture) return texture;
  }
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 48));
  const view = document.createElement('pre');
  view.textContent = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(' ');
  return labelPreview(view, '文件头 · 前 ' + bytes.length + ' 字节');
}
