import { validateStoreLink } from './store-links.js';

export const PLAYABLE_BRANDING_VARIANTS = Object.freeze([
  // One BL package serves both stores. The icon is not baked per variant any
  // more: both art files ship inside the single build and the runtime picks one
  // from the device UA, exactly like it already picks the store link. Splitting
  // Android and iOS into separate downloads doubled the upload work for files
  // that differed by one image, and a wrong-device preview of either half
  // showed the other store's icon.
  Object.freeze({
    id: 'bus',
    suffix: '',
    iconAsset: '/assets/icon-android.jpg',
    iconAssets: Object.freeze({
      android: '/assets/icon-android.jpg',
      ios: '/assets/icon-ios.png'
    }),
    // BL and BFT are different games: a BL package must never carry the BFT
    // wordmark just because the editor preview was left on the other brand.
    logoAsset: '/assets/main-loading-icon-small.png',
    // Both UAs must pass: the same file is uploaded to both stores.
    runtimeDevices: Object.freeze(['android', 'ios'])
  })
]);
// Bus Fever ships a separate Android and iOS icon; the Crowd playable is one
// build shared by both stores, so it keeps a single variant with its own art.
// The Crowd playable also advertises its own store listings: the editor tuning
// still carries the Bus Fever links, and a Crowd package that kept them would
// send players to the wrong game.
export const CROWD_STORE_LINKS = Object.freeze({
  android: validateStoreLink(
    'android',
    'https://play.google.com/store/apps/details?id=busflow.traffic.puzzle&hl=en_SG',
    'Crowd Android store link'
  ),
  ios: validateStoreLink(
    'ios',
    'https://apps.apple.com/us/app/bus-crowd-traffic-jam/id6754059516',
    'Crowd iOS store link'
  )
});
export const PLAYABLE_BRANDING_SETS = Object.freeze({
  bus: Object.freeze([...PLAYABLE_BRANDING_VARIANTS]),
  crowd: Object.freeze([
    Object.freeze({
      id: 'crowd',
      iconAsset: '/assets/icon-crowd.jpg',
      // Both store slots point at the same art. This is not cosmetic: the base
      // tuning carries Bus's per-device icons, and the workspace applies tuning by
      // deep-merging, which cannot remove a key. Without an explicit override a
      // Crowd build kept the Bus icon and the runtime picked it by user agent.
      iconAssets: Object.freeze({
        android: '/assets/icon-crowd.jpg',
        ios: '/assets/icon-crowd.jpg'
      }),
      logoAsset: '/assets/main-loading-icon-crowd.webp',
      storeLinks: CROWD_STORE_LINKS,
      runtimeDevices: Object.freeze(['android', 'ios']),
      // BFT names its packages exactly like BL does; the requirement code
      // (`BFT-2610293`), requester and step tag all come from the tuning the
      // operator exported. This set must not invent `BFT`/`ZZN`, or a delivery
      // is renamed into a different requirement than the one being worked on.
      //
      // The two store listings are worded differently — `Bus Crowd` on Google
      // Play, `Bus Crowd - Traffic Jam` on the App Store — so the pair travels in
      // `branding.storeTitles` and the runtime caption follows the same storefront
      // as the icon and the store link. `textContent` stays the fuller name so a
      // build that somehow reaches neither branch still reads as the long title.
      // Every name this set has ever shipped counts as untouched, so a session
      // saved before the split is not mistaken for hand-written copy.
      textContent: 'Bus Crowd - Traffic Jam',
      defaultTextContent: ['Bus Fever Party!', 'Bus Crowd'],
      storeTitles: Object.freeze({
        google: 'Bus Crowd',
        ios: 'Bus Crowd - Traffic Jam'
      }),
      // The Crowd wordmark under the CTA has to sit dead centre. The editor
      // stores a draggable x, and a saved session can leave it a few pixels off
      // (a 534 instead of 540 shipped once), so the Crowd set pins the text to
      // the design centre instead of trusting whatever the tuning carries.
      centerText: true,
      loadingTitle: 'Bus Crowd - Traffic Jam'
    })
  ])
});

// A saved level keeps whatever caption it last exported with, so every wording
// a set has ever shipped counts as "untouched". Without that, re-exporting a
// session authored against the old short name would pin it forever while a
// fresh session got the new one.
function isVariantDefaultText(current, variant) {
  const defaults = [variant.defaultTextContent ?? []].flat();
  return defaults.some((value) => value && current === value);
}

export function createBrandingVariantTuning(tuning, variantId) {
  const variant = Object.values(PLAYABLE_BRANDING_SETS)
    .flat()
    .find(({ id }) => id === variantId);
  if (!variant) throw new TypeError(`Unsupported playable branding variant: ${variantId ?? '<missing>'}.`);
  const output = structuredClone(tuning ?? {});
  output.branding ??= {};
  output.branding.icon ??= {};
  output.branding.icon.asset = variant.iconAsset;
  if (variant.iconAssets) {
    output.branding.icon.deviceAssets = { ...variant.iconAssets };
  } else {
    // A set with one icon for every device must clear whatever per-device map the
    // tuning carried, or Crowd would keep rendering the Bus/Play badge the
    // operator happened to have selected.
    delete output.branding.icon.deviceAssets;
  }
  if (variant.logoAsset) {
    output.branding.logo ??= {};
    output.branding.logo.asset = variant.logoAsset;
  }
  if (variant.storeLinks) {
    output.storeLinks = { ...variant.storeLinks };
  }
  if (variant.textContent) {
    output.branding.text ??= {};
    const current = String(output.branding.text.content ?? '').trim();
    if (!current || isVariantDefaultText(current, variant)) {
      output.branding.text.content = variant.textContent;
    }
  }
  if (variant.centerText) {
    output.branding.text ??= {};
    // Preview size is the authoring canvas the editor's x is expressed in, so
    // its half width is the horizontal centre for every rendered ad size.
    const designWidth = Number(output.preview?.width) > 0 ? Number(output.preview.width) : 1080;
    output.branding.text.x = designWidth / 2;
  }
  if (variant.loadingTitle) {
    output.branding.loading ??= {};
    output.branding.loading.icon = '';
    output.branding.loading.title = variant.loadingTitle;
  }
  // Per-storefront brand names. Written unconditionally, including the empty Bus
  // pair: the workspace deep-merges tuning and cannot delete a key, so a Bus
  // export started from a Crowd session would otherwise keep Crowd's names. An
  // empty pair is what tells the runtime to use the per-market title tables.
  output.branding.storeTitles = variant.storeTitles
    ? { ...variant.storeTitles }
    : { google: '', ios: '' };
  if (variant.exportNaming) {
    output.exportNaming ??= {};
    Object.assign(output.exportNaming, variant.exportNaming);
  }
  return output;
}
