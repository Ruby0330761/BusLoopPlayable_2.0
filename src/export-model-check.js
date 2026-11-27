const MODEL_FILE = /(?:\.fbx(?:\.bin)?|_vatmesh\.bin|\.glb|\.gltf)$/iu;
export const LARGE_ASSET_BYTES = 100_000;

export function largeSourceModels(artifacts) {
  const sizes = new Map();
  for (const artifact of artifacts) {
    for (const { url, sourceBytes } of artifact.assetDelivery?.assets ?? []) {
      if (MODEL_FILE.test(url) && sourceBytes > Math.max(LARGE_ASSET_BYTES, sizes.get(url) ?? 0)) {
        sizes.set(url, sourceBytes);
      }
    }
  }
  return [...sizes].map(([url, bytes]) => ({ url, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.url.localeCompare(b.url));
}
