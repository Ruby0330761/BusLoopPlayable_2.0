import { EDITOR_EDITION_BADGE } from './build-version.js';
import { createBrandingVariantTuning } from './export-branding.js';
import { expandExportVariantTunings } from './export-variants.js';
import { formatCompleteExportName, parseDeliveryNames } from './export-naming.js';
import { createEditorExportSession } from './playable-session-config.js';
import { LARGE_ASSET_BYTES, largeSourceModels } from './export-model-check.js';

export { LARGE_ASSET_BYTES };

export function exportReviewPreviewKind(url, mime = '') {
  if (/^image\/(?:png|jpeg|webp|gif|avif)$/u.test(mime)) return 'image';
  if (/^audio\/(?:mpeg|wav|ogg|mp4|webm)$/u.test(mime)) return 'audio';
  if (/^video\/(?:mp4|webm|ogg)$/u.test(mime)) return 'video';
  if (/\.fbx(?:\.bin)?$/iu.test(url)) return 'model';
  if (/\.(?:rgba16f|vatq)$/iu.test(url)) return 'vat';
  return 'binary';
}

export function buildExportReview(tuning, { brandingSet, platforms, deliveryNames = '' }) {
  const session = createEditorExportSession(tuning);
  for (const stage of session.sessions[session.active].stages) {
    const count = stage.scene?.parkingSpots?.count ?? tuning.parkingSpots?.count;
    if (!Number.isInteger(count) || count < 1) throw new TypeError('请返回设置车位数量。');
  }

  const branded = createBrandingVariantTuning(tuning, brandingSet);
  const { entries, errors } = parseDeliveryNames(deliveryNames, tuning.exportNaming, brandingSet);
  if (errors.length) throw new TypeError(errors[0]);
  const variants = entries.length ? [] : expandExportVariantTunings(branded);
  const listed = new Map();
  for (const { platform, naming, fileName } of entries) {
    const channel = naming.channels[platform];
    if (!listed.has(channel)) listed.set(channel, []);
    listed.get(channel).push(fileName);
  }
  return {
    iqEnabled: Number(tuning.iq?.enabled) === 1,
    names: entries.length ? [...listed].map(([channel, files]) => ({ channel, files })) : platforms.map(([platform, , format]) => ({
      channel: branded.exportNaming.channels[platform],
      files: variants.map(({ exportNaming }) => {
        const stem = formatCompleteExportName(exportNaming, platform);
        return (platform === 'mintegral' ? stem.replaceAll('-', '_') : stem) + '.' + format.toLowerCase();
      })
    })),
    branding: [
      { label: 'Android Icon', asset: branded.branding.icon.deviceAssets.android, visible: Boolean(branded.branding.icon.enabled ?? 1) },
      { label: 'iOS Icon', asset: branded.branding.icon.deviceAssets.ios, visible: Boolean(branded.branding.icon.enabled ?? 1) },
      { label: 'Logo', asset: branded.branding.logo.asset, visible: Boolean(branded.branding.logo.enabled ?? 1) }
    ]
  };
}

export function summarizeExportPackage(result, previewHashes = new Set()) {
  const artifacts = result.artifacts ?? [result];
  const assets = new Map();
  for (const artifact of artifacts) {
    for (const asset of artifact.assetDelivery?.assets ?? []) {
      const { url, deliveryBytes } = asset;
      if (deliveryBytes > Math.max(LARGE_ASSET_BYTES, assets.get(url)?.bytes ?? 0)) {
        const { deliverySha256, mime } = asset;
        const preview = previewHashes.has(deliverySha256)
          ? { hash: deliverySha256, kind: exportReviewPreviewKind(url, mime) }
          : null;
        assets.set(url, { url, bytes: deliveryBytes, ...(preview && { preview }) });
      }
    }
  }
  return {
    fileName: result.fileName,
    bytes: result.bytes,
    sourceModels: largeSourceModels(artifacts),
    artifacts: artifacts.map(({ fileName, bytes, uncompressedBytes }) => ({ fileName, bytes, uncompressedBytes })),
    assets: [...assets.values()].sort((a, b) => b.bytes - a.bytes || a.url.localeCompare(b.url))
  };
}

function reviewSize(bytes) {
  return bytes >= 1_000_000 ? (bytes / 1_000_000).toFixed(2) + ' MB' : (bytes / 1000).toFixed(1) + ' KB';
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function confirmPlayableExport(root, review, prepare) {
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-export-confirm';
  dialog.setAttribute('aria-labelledby', 'export-confirm-heading');
  dialog.innerHTML = `<form method="dialog">
    <header><div class="export-review-heading"><h3 id="export-confirm-heading" tabindex="-1"></h3>${EDITOR_EDITION_BADGE}</div><output aria-live="polite"></output></header>
    <div class="export-review-warning" role="status" hidden>
      <span aria-hidden="true">!</span><strong></strong>
    </div>
    <p class="export-review-check-status" role="status" hidden></p>
    <div class="export-review-list">
      <section data-review-page="names"><div class="export-review-first-assets"></div><ul class="export-review-names"></ul></section>
      <section data-review-page="branding"><div class="export-review-branding"></div><p role="status" hidden></p></section>
      <section data-review-page="package"><div></div></section>
    </div>
    <footer><button value="cancel">返回修改</button><button type="button" value="back">上一步</button>
      <button type="button" value="confirm"></button></footer>
  </form>`;
  const headings = ['确认导出命名', '核对 Icon 和 Logo', '核对包体积与大素材'];
  const heading = dialog.querySelector('h3');
  const pages = [...dialog.querySelectorAll('[data-review-page]')];
  const back = dialog.querySelector('[value="back"]');
  const next = dialog.querySelector('[value="confirm"]');
  const warning = dialog.querySelector('.export-review-warning');
  const packageStatus = dialog.querySelector('.export-review-check-status');
  const firstAssets = pages[0].querySelector('.export-review-first-assets');
  const packageContent = pages[2].querySelector('div');
  const brandingStatus = pages[1].querySelector('p');
  let step = 0;
  let readyImages = 0;
  let prepared = null;
  let preparation = null;
  let loading = false;
  let failed = false;
  const controller = new AbortController();
  const previewUrls = new Set();

  for (const { channel, files } of review.names) {
    const row = element('li');
    const names = element('div');
    names.append(...files.map(file => element('code', file)));
    row.append(element('strong', channel), names);
    pages[0].querySelector('.export-review-names').append(row);
  }
  for (const { label, asset, visible } of review.branding) {
    const figure = element('figure');
    const image = element('img');
    image.alt = label;
    image.addEventListener('load', () => { readyImages += 1; updateButtons(); }, { once: true });
    image.addEventListener('error', () => {
      brandingStatus.hidden = false;
      brandingStatus.textContent = '品牌图片加载失败，请返回重试。';
    }, { once: true });
    image.src = asset;
    figure.append(image, element('figcaption', label + (visible ? '' : '（隐藏）')));
    pages[1].querySelector('div').append(figure);
  }

  function updateButtons() {
    back.hidden = step === 0;
    warning.hidden = step === 1 || !prepared?.assets.length;
    packageStatus.hidden = step === 1 || !(loading || failed || (step === 0 && !prepared?.assets.length));
    if (failed && step !== 1) next.textContent = '重试准备';
    else if (step < 2) next.textContent = '确认，下一步';
    else next.textContent = warning.hidden ? '确认导出' : '继续导出';
    next.disabled = (step === 1 && readyImages !== review.branding.length)
      || (step === 2 && (loading || (!prepared && !failed)));
  }

  function renderAssetPreview(summary, asset, name) {
    const { hash, kind } = asset.preview ?? {};
    if (!hash) return element('small', '暂无可预览内容');
    const url = '/__playable-export-resource?' + new URLSearchParams({ id: summary.id, hash });
    const preview = element('div');
    preview.className = 'export-review-preview';
    if (kind === 'image') {
      const image = element('img');
      image.alt = name;
      image.loading = 'lazy';
      image.addEventListener('error', () => image.replaceWith(element('small', '图片预览加载失败')), { once: true });
      image.src = url;
      preview.append(image);
      return preview;
    }

    const details = element('details');
    const labels = { audio: '试听音频', video: '观看视频', model: '预览模型', vat: '预览动画纹理', binary: '预览文件数据' };
    const content = element('div');
    details.append(element('summary', labels[kind]), content);
    details.addEventListener('toggle', async () => {
      if (!details.open) {
        content.querySelector('audio,video')?.pause();
        return;
      }
      if (content.childNodes.length) return;
      content.append(element('p', '正在加载素材预览…'));
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('素材预览加载失败');
        if (kind === 'audio' || kind === 'video') {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          const media = element(kind);
          media.controls = true;
          media.preload = 'metadata';
          if (kind === 'video') media.playsInline = true;
          const mediaUrl = URL.createObjectURL(blob);
          previewUrls.add(mediaUrl);
          media.src = mediaUrl;
          media.addEventListener('error', () => media.replaceWith(element('p', '此格式无法播放')), { once: true });
          content.replaceChildren(media);
        } else {
          const { renderExportBinaryPreview } = await import('./export-asset-preview.js');
          const item = await renderExportBinaryPreview(await response.arrayBuffer(), asset.url, kind);
          if (!controller.signal.aborted) content.replaceChildren(item);
        }
      } catch {
        if (!controller.signal.aborted) content.replaceChildren(element('p', '素材预览加载失败'));
      }
    });
    preview.append(details);
    return preview;
  }

  function renderPackage(summary) {
    if (summary.sourceModels?.length) {
      const models = element('details');
      const list = element('ul');
      models.append(element('summary', `模型源文件超过 100 KB（${summary.sourceModels.length} 项）`), list);
      for (const { url, bytes } of summary.sourceModels) list.append(element('li', url.split('/').at(-1) + ' · ' + reviewSize(bytes)));
      firstAssets.append(models);
    }
    const size = element('p');
    size.className = 'export-review-size';
    size.append(element('span', '导出包体积'), element('strong', reviewSize(summary.bytes)));
    size.title = summary.fileName + ' · ' + summary.bytes.toLocaleString() + ' 字节';
    packageContent.append(size);
    if (review.iqEnabled) packageContent.append(element('p', 'IQ 计分已开启，车辆进站 +10，碰撞 −5，最低 0 分。'));
    if (summary.artifacts.length > 1) {
      const details = element('details');
      const files = element('ul');
      details.append(element('summary', '各交付文件大小'), files);
      for (const artifact of summary.artifacts) {
        files.append(element('li', artifact.fileName + ' · ' + reviewSize(artifact.bytes)));
      }
      packageContent.append(details);
    }
    if (!summary.assets.length) {
      packageStatus.textContent = '本次交付素材均在 100 KB 以内。';
      packageContent.append(element('p', packageStatus.textContent));
      return;
    }
    warning.querySelector('strong').textContent = `${summary.assets.length} 项素材超过 100 KB`;
    packageContent.append(element('h4', '超限素材明细'));
    const assets = element('ul');
    assets.className = 'export-review-assets';
    const firstList = element('ul');
    firstList.className = 'export-review-assets';
    firstAssets.prepend(firstList);
    for (const asset of summary.assets) {
      const { url, bytes } = asset;
      const row = element('li');
      const name = element('span', url.split('/').at(-1));
      name.title = url;
      const excess = bytes - LARGE_ASSET_BYTES;
      const measure = element('div');
      measure.className = 'export-review-asset-size';
      const displaySize = excess < 100 ? (bytes / 1000).toLocaleString('zh-CN') + ' KB' : reviewSize(bytes);
      measure.append(element('strong', displaySize), element('small', '超出 ' + (excess < 1000 ? excess + ' B' : reviewSize(excess))));
      const firstRow = element('li');
      firstRow.append(name.cloneNode(true), measure.cloneNode(true));
      firstList.append(firstRow);
      row.append(name, measure, renderAssetPreview(summary, asset, name.textContent));
      assets.append(row);
    }
    packageContent.append(assets);
  }

  async function preparePackage() {
    loading = true;
    failed = false;
    packageStatus.textContent = '正在准备导出包并计算实际体积…';
    updateButtons();
    try {
      prepared = await prepare(controller.signal, message => { packageStatus.textContent = message; });
      if (!dialog.open) return;
      renderPackage(prepared);
    } catch (error) {
      if (!controller.signal.aborted) {
        failed = true;
        packageStatus.textContent = error.message;
      }
    } finally {
      loading = false;
      updateButtons();
    }
  }

  function showStep(index) {
    step = index;
    if (step !== 2) packageContent.querySelectorAll('audio,video').forEach(media => media.pause());
    heading.textContent = headings[step];
    dialog.querySelector('output').textContent = (step + 1) + ' / ' + headings.length;
    pages.forEach((page, i) => { page.hidden = i !== step; });
    dialog.querySelector('.export-review-list').scrollTop = 0;
    updateButtons();
    if (dialog.open) heading.focus();
  }

  back.addEventListener('click', () => showStep(step - 1));
  next.addEventListener('click', () => {
    if (failed && step !== 1) {
      preparation = preparePackage();
    } else if (step < 2) {
      showStep(step + 1);
    } else if (prepared) {
      dialog.close('confirm');
    }
  });
  showStep(0);
  root.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', async () => {
      controller.abort();
      for (const url of previewUrls) URL.revokeObjectURL(url);
      dialog.remove();
      await preparation;
      resolve(dialog.returnValue === 'confirm');
    }, { once: true });
    dialog.showModal();
    heading.focus();
    preparation = preparePackage();
  });
}
