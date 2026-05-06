const elements = {
  imageInput: document.getElementById('imageInput'),
  folderInput: document.getElementById('folderInput'),
  dropZone: document.getElementById('dropZone'),
  dropZonePlaceholder: document.getElementById('dropZonePlaceholder'),
  originalPreview: document.getElementById('originalPreview'),
  previewImg: document.getElementById('previewImg'),
  removeBtn: document.getElementById('removeImage'),
  pickFilesBtn: document.getElementById('pickFilesBtn'),
  pickFolderBtn: document.getElementById('pickFolderBtn'),
  clearQueueBtn: document.getElementById('clearQueueBtn'),
  queueList: document.getElementById('queueList'),
  fileName: document.getElementById('fileName'),
  outputCanvas: document.getElementById('outputCanvas'),
  emptyState: document.getElementById('emptyState'),
  widthInput: document.getElementById('widthInput'),
  heightInput: document.getElementById('heightInput'),
  scalePercent: document.getElementById('scalePercent'),
  scaleValue: document.getElementById('scaleValue'),
  lockAspect: document.getElementById('lockAspect'),
  preventUpscale: document.getElementById('preventUpscale'),
  formatSelect: document.getElementById('formatSelect'),
  qualityRow: document.getElementById('qualityRow'),
  qualityInput: document.getElementById('qualityInput'),
  qualityValue: document.getElementById('qualityValue'),
  resampleSelect: document.getElementById('resampleSelect'),
  sourceInfo: document.getElementById('sourceInfo'),
  resultInfo: document.getElementById('resultInfo'),
  saveBtn: document.getElementById('saveBtn'),
  saveZipBtn: document.getElementById('saveZipBtn'),
};

const outputCtx = elements.outputCanvas.getContext('2d');
const previewModal = new PreviewModal();
const coreFiles = window.AppCore.files;
const coreZip = window.AppCore.zip;
const coreIngestUi = window.AppCore.ingestUi;
const corePreview = window.AppCore.preview;

let sourceImage = null;
let sourceWidth = 0;
let sourceHeight = 0;
let currentObjectUrl = null;
let currentFile = null;
let currentFileName = '';

let batchQueue = [];
let batchActiveKey = '';
let batchBusy = false;

let dimensionsInitialized = false;
let dimensionSyncLock = false;
let lastDimensionEdited = 'width';
let renderRequestId = null;
let estimateToken = 0;
let fileLoadToken = 0;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function normalizeQueuePath(file, relativePath) {
  return coreFiles.normalizePath(relativePath || file.webkitRelativePath || file.name) || file.name;
}

function makeQueueKey(file, relativePath) {
  return `${normalizeQueuePath(file, relativePath)}|${file.size}|${file.lastModified}`;
}

function toSafeInt(value, fallback, min = 1, max = 12000) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function setDimensionInputs(width, height) {
  dimensionSyncLock = true;
  elements.widthInput.value = String(width);
  elements.heightInput.value = String(height);
  dimensionSyncLock = false;
}

function setScaleInput(percent) {
  const clamped = Math.max(5, Math.min(400, Math.round(percent)));
  elements.scalePercent.value = String(clamped);
  elements.scaleValue.textContent = `${clamped}%`;
}

function updateQualityLabel() {
  elements.qualityValue.textContent = `${elements.qualityInput.value}%`;
}

function mimeUsesQuality(mime) {
  return mime === 'image/jpeg' || mime === 'image/webp';
}

function mimeToExtension(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function getOutputMimeForFile(file) {
  const format = elements.formatSelect.value;
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'png') return 'image/png';

  const type = String(file && file.type ? file.type : '').toLowerCase();
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
    return type;
  }

  return 'image/png';
}

function getOutputQuality(mime) {
  if (!mimeUsesQuality(mime)) return undefined;
  const value = toSafeInt(elements.qualityInput.value, 82, 30, 100);
  return value / 100;
}

function updateQualityVisibility() {
  const mime = getOutputMimeForFile(currentFile);
  elements.qualityRow.style.display = mimeUsesQuality(mime) ? '' : 'none';
}

function updateSaveButtonLabel() {
  if (!elements.saveBtn) return;
  if (!sourceImage) {
    elements.saveBtn.textContent = 'Сохранить файл';
    elements.saveBtn.disabled = true;
    return;
  }

  const mime = getOutputMimeForFile(currentFile);
  const ext = mimeToExtension(mime).toUpperCase();
  elements.saveBtn.textContent = `Сохранить ${ext}`;
  elements.saveBtn.disabled = batchBusy;
}

function updateSourceInfo() {
  if (!sourceImage || !sourceWidth || !sourceHeight) {
    elements.sourceInfo.textContent = 'Исходник: —';
    return;
  }

  const fileSize = currentFile ? formatBytes(currentFile.size) : '—';
  elements.sourceInfo.textContent = `Исходник: ${sourceWidth} x ${sourceHeight} • ${fileSize}`;
}

function updateResultInfoPending(width, height) {
  if (!sourceImage || !width || !height) {
    elements.resultInfo.textContent = 'Результат: —';
    return;
  }

  elements.resultInfo.textContent = `Результат: ${width} x ${height} • расчёт...`;
}

function renderQueueList() {
  coreIngestUi.renderQueue({
    queueList: elements.queueList,
    items: batchQueue,
    isBusy: batchBusy,
    getItemId: (item) => item.key,
    isActive: (item) => item.key === batchActiveKey,
    getName: (item) => item.file.name || 'file',
    getPath: (item) => (item.relativePath && item.relativePath !== item.file.name ? item.relativePath : ''),
    getBadgeClass: (item) => (item.key === batchActiveKey ? 'processing' : 'pending'),
    getBadgeText: (item) => (item.key === batchActiveKey ? 'выбран' : 'новый'),
  });
}

function updateQueueSummary() {
  if (!batchQueue.length) {
    elements.fileName.textContent = sourceImage ? currentFileName || 'Файл загружен' : 'Очередь пуста';
    return;
  }

  const activeItem = batchQueue.find((item) => item.key === batchActiveKey);
  const activeLabel = activeItem ? ` Выбран: ${activeItem.file.name}.` : '';
  elements.fileName.textContent = `Файлов в очереди: ${batchQueue.length}.${activeLabel}`;
}

function updateBatchButtons() {
  coreIngestUi.updateIngestButtons({
    pickFilesBtn: elements.pickFilesBtn,
    pickFolderBtn: elements.pickFolderBtn,
    clearQueueBtn: elements.clearQueueBtn,
    fileInput: elements.imageInput,
    folderInput: elements.folderInput,
    zipBtn: elements.saveZipBtn,
    busy: batchBusy,
    queueLength: batchQueue.length,
  });
}

function setBatchBusy(isBusy) {
  batchBusy = Boolean(isBusy);
  renderQueueList();
  updateBatchButtons();
  updateSaveButtonLabel();
}

function syncActiveQueueWithFile(file) {
  if (!file || !batchQueue.length) return;
  const match = batchQueue.find((item) => item.file === file);
  if (match) {
    batchActiveKey = match.key;
  }
  renderQueueList();
  updateQueueSummary();
}

function clearPreview() {
  corePreview.clear({
    previewImg: elements.previewImg,
    originalPreview: elements.originalPreview,
    placeholder: elements.dropZonePlaceholder,
  });
}

function showOriginalPreview(src, onload) {
  corePreview.show({
    previewImg: elements.previewImg,
    originalPreview: elements.originalPreview,
    placeholder: elements.dropZonePlaceholder,
    src,
    onload,
  });
}

function clearCurrentImageState(options) {
  const skipSummary = options && options.skipSummary;

  fileLoadToken += 1;
  estimateToken += 1;

  if (renderRequestId) {
    cancelAnimationFrame(renderRequestId);
    renderRequestId = null;
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  sourceImage = null;
  sourceWidth = 0;
  sourceHeight = 0;
  currentFile = null;
  currentFileName = '';
  dimensionsInitialized = false;
  lastDimensionEdited = 'width';

  outputCtx.clearRect(0, 0, elements.outputCanvas.width, elements.outputCanvas.height);
  elements.outputCanvas.width = 0;
  elements.outputCanvas.height = 0;
  elements.outputCanvas.classList.remove('pixelated');
  elements.emptyState.style.display = 'grid';

  elements.imageInput.value = '';
  if (elements.folderInput) {
    elements.folderInput.value = '';
  }

  clearPreview();
  if (previewModal.isOpen) {
    previewModal.close();
  }

  updateSourceInfo();
  updateResultInfoPending(0, 0);
  updateQualityVisibility();
  updateSaveButtonLabel();

  if (!skipSummary) {
    updateQueueSummary();
  }
}

function getBatchQueueItems() {
  return batchQueue.slice();
}

function addFilesToQueue(entries, sourceLabel) {
  const source = sourceLabel || 'источника';
  const deduped = coreFiles.dedupeFileEntries(entries || []);
  const existingKeys = new Set(batchQueue.map((item) => item.key));

  let added = 0;
  let skipped = 0;
  let firstAdded = null;

  for (const entry of deduped) {
    if (!entry || !entry.file) continue;
    if (!coreFiles.isImageFile(entry.file)) {
      skipped += 1;
      continue;
    }

    const normalizedPath = normalizeQueuePath(entry.file, entry.relativePath);
    const key = makeQueueKey(entry.file, normalizedPath);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    const item = {
      file: entry.file,
      relativePath: normalizedPath,
      key,
    };

    if (!firstAdded) {
      firstAdded = item;
    }

    batchQueue.push(item);
    existingKeys.add(key);
    added += 1;
  }

  if (!added) {
    renderQueueList();
    updateQueueSummary();
    updateBatchButtons();
    if (skipped > 0) {
      alert('Новых подходящих изображений не добавлено.');
    }
    return;
  }

  if (firstAdded) {
    batchActiveKey = firstAdded.key;
    handleFile(firstAdded.file);
  }

  renderQueueList();
  updateQueueSummary();
  updateBatchButtons();

  if (skipped > 0) {
    console.info(`Добавлено ${added} файл(ов) из ${source}. Пропущено: ${skipped}.`);
  }
}

function removeActiveQueueItem() {
  if (!batchQueue.length) return false;

  let index = batchQueue.findIndex((item) => item.key === batchActiveKey);
  if (index < 0 && currentFile) {
    index = batchQueue.findIndex((item) => item.file === currentFile);
  }
  if (index < 0) return false;

  batchQueue.splice(index, 1);

  if (!batchQueue.length) {
    batchActiveKey = '';
    clearCurrentImageState();
    renderQueueList();
    updateBatchButtons();
    return true;
  }

  const nextIndex = Math.min(index, batchQueue.length - 1);
  const nextItem = batchQueue[nextIndex];
  batchActiveKey = nextItem.key;
  handleFile(nextItem.file);

  renderQueueList();
  updateQueueSummary();
  updateBatchButtons();
  return true;
}

function removeQueueItemByKey(key) {
  if (!key || !batchQueue.length) return false;
  const index = batchQueue.findIndex((item) => item.key === key);
  if (index < 0) return false;

  const removed = batchQueue[index];
  batchQueue.splice(index, 1);

  if (!batchQueue.length) {
    batchActiveKey = '';
    clearCurrentImageState();
    renderQueueList();
    updateBatchButtons();
    return true;
  }

  if (removed.key === batchActiveKey) {
    const nextIndex = Math.min(index, batchQueue.length - 1);
    const nextItem = batchQueue[nextIndex];
    batchActiveKey = nextItem.key;
    handleFile(nextItem.file);
  } else {
    renderQueueList();
    updateQueueSummary();
    updateBatchButtons();
  }

  return true;
}

function clearQueue() {
  batchQueue = [];
  batchActiveKey = '';
  clearCurrentImageState();
  renderQueueList();
  updateBatchButtons();
}

function selectQueueItemByKey(key) {
  if (!key) return;
  const item = batchQueue.find((entry) => entry.key === key);
  if (!item) return;
  if (item.key === batchActiveKey) return;

  batchActiveKey = item.key;
  renderQueueList();
  updateQueueSummary();
  handleFile(item.file);
}

function computeTargetDimensions(image, options) {
  const shouldUpdateInputs = !(options && options.updateInputs === false);

  const srcW = Math.max(1, image.naturalWidth || image.width || sourceWidth || 1);
  const srcH = Math.max(1, image.naturalHeight || image.height || sourceHeight || 1);

  let width = toSafeInt(elements.widthInput.value, srcW);
  let height = toSafeInt(elements.heightInput.value, srcH);
  const keepAspect = Boolean(elements.lockAspect.checked);

  if (keepAspect) {
    if (lastDimensionEdited === 'height') {
      width = Math.max(1, Math.round((height * srcW) / srcH));
    } else {
      height = Math.max(1, Math.round((width * srcH) / srcW));
    }
  }

  if (elements.preventUpscale.checked) {
    if (width > srcW || height > srcH) {
      if (keepAspect) {
        const scale = Math.min(srcW / width, srcH / height, 1);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      } else {
        width = Math.min(width, srcW);
        height = Math.min(height, srcH);
      }
    }
  }

  width = Math.max(1, Math.min(12000, width));
  height = Math.max(1, Math.min(12000, height));

  const scalePercent = srcW > 0 ? Math.round((width / srcW) * 100) : 100;

  if (shouldUpdateInputs) {
    setDimensionInputs(width, height);
    setScaleInput(scalePercent);
  }

  return {
    width,
    height,
    srcW,
    srcH,
    scalePercent,
  };
}

function renderToCanvas(image, canvas, width, height) {
  const ctx = canvas.getContext('2d');
  canvas.width = width;
  canvas.height = height;

  const resample = elements.resampleSelect.value;
  if (resample === 'pixelated') {
    ctx.imageSmoothingEnabled = false;
    canvas.classList.add('pixelated');
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = resample;
    canvas.classList.remove('pixelated');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
}

function scheduleRender() {
  if (!sourceImage) return;

  if (renderRequestId) {
    cancelAnimationFrame(renderRequestId);
  }

  renderRequestId = requestAnimationFrame(() => {
    renderRequestId = null;
    render();
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, mime, quality);
  });
}

async function canvasToOutputBlob(canvas, preferredMime, quality) {
  const direct = await canvasToBlob(canvas, preferredMime, quality);
  if (direct) {
    const mime = direct.type && direct.type.startsWith('image/') ? direct.type : preferredMime;
    return { blob: direct, mime };
  }

  if (preferredMime !== 'image/png') {
    const fallback = await canvasToBlob(canvas, 'image/png');
    if (fallback) {
      return { blob: fallback, mime: 'image/png' };
    }
  }

  throw new Error('Не удалось сформировать файл изображения.');
}

async function updateEstimate(width, height) {
  if (!sourceImage || !elements.outputCanvas.width || !elements.outputCanvas.height) {
    updateResultInfoPending(0, 0);
    return;
  }

  const token = ++estimateToken;
  const targetMime = getOutputMimeForFile(currentFile);
  const quality = getOutputQuality(targetMime);

  try {
    const { blob, mime } = await canvasToOutputBlob(elements.outputCanvas, targetMime, quality);
    if (token !== estimateToken) return;

    const ext = mimeToExtension(mime).toUpperCase();
    elements.resultInfo.textContent = `Результат: ${width} x ${height} • ${formatBytes(blob.size)} • ${ext}`;
  } catch (err) {
    if (token !== estimateToken) return;
    console.warn(err);
    elements.resultInfo.textContent = `Результат: ${width} x ${height} • ошибка расчёта`;
  }
}

function render() {
  if (!sourceImage) return;

  const size = computeTargetDimensions(sourceImage, { updateInputs: true });
  renderToCanvas(sourceImage, elements.outputCanvas, size.width, size.height);
  elements.emptyState.style.display = 'none';

  updateSourceInfo();
  updateQualityVisibility();
  updateSaveButtonLabel();
  updateResultInfoPending(size.width, size.height);
  void updateEstimate(size.width, size.height);

  if (previewModal.isOpen) {
    previewModal.update(elements.outputCanvas);
  }
}

function primeDimensionsForImage() {
  if (!sourceWidth || !sourceHeight) return;

  if (!dimensionsInitialized) {
    setDimensionInputs(sourceWidth, sourceHeight);
    setScaleInput(100);
    dimensionsInitialized = true;
    lastDimensionEdited = 'width';
    return;
  }

  if (elements.lockAspect.checked) {
    const width = toSafeInt(elements.widthInput.value, sourceWidth);
    const height = Math.max(1, Math.round((width * sourceHeight) / sourceWidth));
    setDimensionInputs(width, height);
  }
}

function handleFile(file) {
  if (!file) return;

  const isImage = file.type
    ? file.type.startsWith('image/')
    : coreFiles.isImageFile(file);

  if (!isImage) {
    alert('Пожалуйста, выберите изображение.');
    return;
  }

  const token = ++fileLoadToken;

  currentFile = file;
  currentFileName = file.name || '';
  syncActiveQueueWithFile(file);

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  const objectUrl = URL.createObjectURL(file);
  currentObjectUrl = objectUrl;

  showOriginalPreview(objectUrl, () => {
    if (token !== fileLoadToken) return;

    sourceImage = elements.previewImg;
    sourceWidth = Math.max(1, sourceImage.naturalWidth || sourceImage.width || 1);
    sourceHeight = Math.max(1, sourceImage.naturalHeight || sourceImage.height || 1);

    primeDimensionsForImage();
    updateQueueSummary();
    render();
  });
}

function buildOutputFileName(fileName, mime) {
  const base = coreFiles.baseName(fileName || 'image');
  const ext = mimeToExtension(mime);
  return `${base}-resized.${ext}`;
}

function buildZipEntryName(queueItem, mime) {
  const relativePath = coreFiles.normalizePath(queueItem.relativePath || queueItem.file.name);
  const segments = relativePath.split('/');

  if (segments.length > 1) {
    segments.pop();
  } else {
    segments.length = 0;
  }

  const dir = segments.join('/');
  const ext = mimeToExtension(mime);
  const outputFileName = `${coreFiles.baseName(queueItem.file.name)}-resized.${ext}`;
  return dir ? coreFiles.sanitizePath(`${dir}/${outputFileName}`) : coreFiles.sanitizePath(outputFileName);
}

async function createOutputBlobForFile(file) {
  const image = await coreFiles.loadImageFromFile(file);
  const size = computeTargetDimensions(image, { updateInputs: false });
  const tempCanvas = document.createElement('canvas');

  renderToCanvas(image, tempCanvas, size.width, size.height);

  const mime = getOutputMimeForFile(file);
  const quality = getOutputQuality(mime);
  return canvasToOutputBlob(tempCanvas, mime, quality);
}

async function saveCurrentFile() {
  if (!sourceImage || !currentFile) {
    alert('Сначала загрузите изображение.');
    return;
  }

  const originalLabel = elements.saveBtn.textContent;
  elements.saveBtn.disabled = true;
  elements.saveBtn.textContent = 'Сохранение...';

  try {
    const preferredMime = getOutputMimeForFile(currentFile);
    const quality = getOutputQuality(preferredMime);
    const { blob, mime } = await canvasToOutputBlob(elements.outputCanvas, preferredMime, quality);
    const fileName = buildOutputFileName(currentFileName || 'image', mime);
    coreZip.triggerDownload(blob, fileName);
  } catch (err) {
    console.error(err);
    alert(err && err.message ? err.message : 'Не удалось сохранить файл.');
  } finally {
    elements.saveBtn.textContent = originalLabel;
    updateSaveButtonLabel();
  }
}

async function saveZip() {
  const queueItems = getBatchQueueItems();
  if (!queueItems.length) {
    alert('Очередь пуста. Добавьте файлы или папку.');
    return;
  }

  const originalLabel = elements.saveZipBtn ? elements.saveZipBtn.textContent : '';
  const entries = [];
  const total = queueItems.length;
  let failed = 0;

  setBatchBusy(true);
  try {
    for (let i = 0; i < queueItems.length; i += 1) {
      coreIngestUi.setZipButtonProgress(elements.saveZipBtn, i + 1, total);

      const queueItem = queueItems[i];
      try {
        const { blob, mime } = await createOutputBlobForFile(queueItem.file);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        entries.push({
          name: buildZipEntryName(queueItem, mime),
          bytes,
        });
      } catch (err) {
        failed += 1;
        console.error(err);
      }
    }

    if (!entries.length) {
      alert('Не удалось сформировать ни одного файла для архива.');
      return;
    }

    const uniqueEntries = coreZip.ensureUniqueEntryNames(entries);
    const zipBlob = coreZip.buildZipBlob(uniqueEntries);
    const zipName = `resize-batch-${coreZip.formatDateStamp(new Date())}.zip`;
    coreZip.triggerDownload(zipBlob, zipName);

    if (failed > 0) {
      alert(`Архив создан. Успешно: ${entries.length}, ошибок: ${failed}.`);
    }
  } finally {
    coreIngestUi.resetZipButtonLabel(elements.saveZipBtn, originalLabel || 'Скачать все (.zip)');
    setBatchBusy(false);
    if (sourceImage) {
      scheduleRender();
    }
  }
}

coreIngestUi.bindIngestControls({
  fileInput: elements.imageInput,
  folderInput: elements.folderInput,
  dropZone: elements.dropZone,
  pickFilesBtn: elements.pickFilesBtn,
  pickFolderBtn: elements.pickFolderBtn,
  clearQueueBtn: elements.clearQueueBtn,
  ignoreSelector: '.icon-btn',
  isBusy: () => batchBusy,
  onEntries: (entries, sourceLabel) => {
    addFilesToQueue(entries, sourceLabel);
  },
  onFile: (file) => {
    handleFile(file);
  },
  onClear: clearQueue,
});

coreIngestUi.bindQueueList({
  queueList: elements.queueList,
  isBusy: () => batchBusy,
  onRemove: (key) => {
    removeQueueItemByKey(key);
  },
  onSelect: (key) => {
    selectQueueItemByKey(key);
  },
});

elements.widthInput.addEventListener('input', () => {
  if (dimensionSyncLock) return;
  lastDimensionEdited = 'width';
  scheduleRender();
});

elements.heightInput.addEventListener('input', () => {
  if (dimensionSyncLock) return;
  lastDimensionEdited = 'height';
  scheduleRender();
});

elements.scalePercent.addEventListener('input', () => {
  setScaleInput(elements.scalePercent.value);

  if (!sourceImage || !sourceWidth || !sourceHeight) {
    return;
  }

  const percent = toSafeInt(elements.scalePercent.value, 100, 5, 400);
  const targetWidth = Math.max(1, Math.round((sourceWidth * percent) / 100));
  const targetHeight = Math.max(1, Math.round((sourceHeight * percent) / 100));
  setDimensionInputs(targetWidth, targetHeight);
  lastDimensionEdited = 'width';
  scheduleRender();
});

elements.lockAspect.addEventListener('change', () => {
  scheduleRender();
});

elements.preventUpscale.addEventListener('change', () => {
  scheduleRender();
});

elements.formatSelect.addEventListener('change', () => {
  updateQualityVisibility();
  updateSaveButtonLabel();
  if (sourceImage) {
    scheduleRender();
  }
});

elements.qualityInput.addEventListener('input', () => {
  updateQualityLabel();
  if (!sourceImage) return;
  updateResultInfoPending(elements.outputCanvas.width, elements.outputCanvas.height);
  void updateEstimate(elements.outputCanvas.width, elements.outputCanvas.height);
});

elements.resampleSelect.addEventListener('change', () => {
  scheduleRender();
});

elements.saveBtn.addEventListener('click', () => {
  void saveCurrentFile();
});

if (elements.saveZipBtn) {
  elements.saveZipBtn.addEventListener('click', () => {
    void saveZip();
  });
}

elements.removeBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (removeActiveQueueItem()) {
    return;
  }
  clearCurrentImageState();
});

elements.outputCanvas.addEventListener('click', () => {
  if (!sourceImage || !elements.outputCanvas.width || !elements.outputCanvas.height) {
    alert('Сначала загрузите изображение!');
    return;
  }
  previewModal.open(elements.outputCanvas);
});

updateQualityLabel();
updateQualityVisibility();
updateSourceInfo();
updateResultInfoPending(0, 0);
updateSaveButtonLabel();
renderQueueList();
updateQueueSummary();
updateBatchButtons();
