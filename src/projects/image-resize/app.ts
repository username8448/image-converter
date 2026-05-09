import { canvasContext2d, errorMessage, requireElement } from '../../shared/js/dom.ts';

type LastDimensionEdited = 'width' | 'height';
type OutputMime = 'image/jpeg' | 'image/webp' | 'image/png';
type ResizeQueueItem = FileEntry & {
  readonly key: string;
};
type ClearImageOptions = {
  readonly skipSummary?: boolean;
};
type DimensionOptions = {
  readonly updateInputs?: boolean;
};
type TargetDimensions = {
  readonly width: number;
  readonly height: number;
  readonly srcW: number;
  readonly srcH: number;
  readonly scalePercent: number;
};
type OutputBlobResult = {
  readonly blob: Blob;
  readonly mime: OutputMime;
};

const elements = {
  imageInput: requireElement('imageInput', HTMLInputElement),
  folderInput: requireElement('folderInput', HTMLInputElement),
  dropZone: requireElement('dropZone', HTMLElement),
  dropZonePlaceholder: requireElement('dropZonePlaceholder', HTMLElement),
  originalPreview: requireElement('originalPreview', HTMLElement),
  previewImg: requireElement('previewImg', HTMLImageElement),
  removeBtn: requireElement('removeImage', HTMLButtonElement),
  pickFilesBtn: requireElement('pickFilesBtn', HTMLButtonElement),
  pickFolderBtn: requireElement('pickFolderBtn', HTMLButtonElement),
  clearQueueBtn: requireElement('clearQueueBtn', HTMLButtonElement),
  queueList: requireElement('queueList', HTMLElement),
  fileName: requireElement('fileName', HTMLElement),
  outputCanvas: requireElement('outputCanvas', HTMLCanvasElement),
  emptyState: requireElement('emptyState', HTMLElement),
  widthInput: requireElement('widthInput', HTMLInputElement),
  heightInput: requireElement('heightInput', HTMLInputElement),
  scalePercent: requireElement('scalePercent', HTMLInputElement),
  scaleValue: requireElement('scaleValue', HTMLElement),
  lockAspect: requireElement('lockAspect', HTMLInputElement),
  preventUpscale: requireElement('preventUpscale', HTMLInputElement),
  formatSelect: requireElement('formatSelect', HTMLSelectElement),
  qualityRow: requireElement('qualityRow', HTMLElement),
  qualityInput: requireElement('qualityInput', HTMLInputElement),
  qualityValue: requireElement('qualityValue', HTMLElement),
  resampleSelect: requireElement('resampleSelect', HTMLSelectElement),
  sourceInfo: requireElement('sourceInfo', HTMLElement),
  resultInfo: requireElement('resultInfo', HTMLElement),
  saveBtn: requireElement('saveBtn', HTMLButtonElement),
  saveZipBtn: requireElement('saveZipBtn', HTMLButtonElement),
};

const outputCtx = canvasContext2d(elements.outputCanvas);
const previewModal = new PreviewModal();
const coreFiles = window.AppCore.files;
const coreZip = window.AppCore.zip;
const coreIngestUi = window.AppCore.ingestUi;
const corePreview = window.AppCore.preview;

let sourceImage: HTMLImageElement | null = null;
let sourceWidth = 0;
let sourceHeight = 0;
let currentObjectUrl: string | null = null;
let currentFile: File | null = null;
let currentFileName = '';

let batchQueue: ResizeQueueItem[] = [];
let batchActiveKey = '';
let batchBusy = false;

let dimensionsInitialized = false;
let dimensionSyncLock = false;
let lastDimensionEdited: LastDimensionEdited = 'width';
let renderRequestId: number | null = null;
let estimateToken = 0;
let fileLoadToken = 0;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function normalizeQueuePath(file: File, relativePath?: string): string {
  return coreFiles.normalizePath(relativePath || file.webkitRelativePath || file.name) || file.name;
}

function makeQueueKey(file: File, relativePath?: string): string {
  return `${normalizeQueuePath(file, relativePath)}|${file.size}|${file.lastModified}`;
}

function toSafeInt(value: unknown, fallback: number, min = 1, max = 12000): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function setDimensionInputs(width: number, height: number): void {
  dimensionSyncLock = true;
  elements.widthInput.value = String(width);
  elements.heightInput.value = String(height);
  dimensionSyncLock = false;
}

function setScaleInput(percent: unknown): void {
  const numeric = Number(percent);
  const clamped = Math.max(5, Math.min(400, Math.round(Number.isFinite(numeric) ? numeric : 100)));
  elements.scalePercent.value = String(clamped);
  elements.scaleValue.textContent = `${clamped}%`;
}

function updateQualityLabel(): void {
  elements.qualityValue.textContent = `${elements.qualityInput.value}%`;
}

function mimeUsesQuality(mime: OutputMime): boolean {
  return mime === 'image/jpeg' || mime === 'image/webp';
}

function mimeToExtension(mime: OutputMime): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function getOutputMimeForFile(file: File | null): OutputMime {
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

function getOutputQuality(mime: OutputMime): number | undefined {
  if (!mimeUsesQuality(mime)) return undefined;
  const value = toSafeInt(elements.qualityInput.value, 82, 30, 100);
  return value / 100;
}

function updateQualityVisibility(): void {
  const mime = getOutputMimeForFile(currentFile);
  elements.qualityRow.style.display = mimeUsesQuality(mime) ? '' : 'none';
}

function updateSaveButtonLabel(): void {
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

function updateSourceInfo(): void {
  if (!sourceImage || !sourceWidth || !sourceHeight) {
    elements.sourceInfo.textContent = 'Исходник: —';
    return;
  }

  const fileSize = currentFile ? formatBytes(currentFile.size) : '—';
  elements.sourceInfo.textContent = `Исходник: ${sourceWidth} x ${sourceHeight} • ${fileSize}`;
}

function updateResultInfoPending(width: number, height: number): void {
  if (!sourceImage || !width || !height) {
    elements.resultInfo.textContent = 'Результат: —';
    return;
  }

  elements.resultInfo.textContent = `Результат: ${width} x ${height} • расчёт...`;
}

function renderQueueList(): void {
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

function updateQueueSummary(): void {
  if (!batchQueue.length) {
    elements.fileName.textContent = sourceImage ? currentFileName || 'Файл загружен' : 'Очередь пуста';
    return;
  }

  const activeItem = batchQueue.find((item) => item.key === batchActiveKey);
  const activeLabel = activeItem ? ` Выбран: ${activeItem.file.name}.` : '';
  elements.fileName.textContent = `Файлов в очереди: ${batchQueue.length}.${activeLabel}`;
}

function updateBatchButtons(): void {
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

function setBatchBusy(isBusy: boolean): void {
  batchBusy = Boolean(isBusy);
  renderQueueList();
  updateBatchButtons();
  updateSaveButtonLabel();
}

function syncActiveQueueWithFile(file: File): void {
  if (!file || !batchQueue.length) return;
  const match = batchQueue.find((item) => item.file === file);
  if (match) {
    batchActiveKey = match.key;
  }
  renderQueueList();
  updateQueueSummary();
}

function clearPreview(): void {
  corePreview.clear({
    previewImg: elements.previewImg,
    originalPreview: elements.originalPreview,
    placeholder: elements.dropZonePlaceholder,
  });
}

function showOriginalPreview(src: string, onload: () => void): void {
  corePreview.show({
    previewImg: elements.previewImg,
    originalPreview: elements.originalPreview,
    placeholder: elements.dropZonePlaceholder,
    src,
    onload,
  });
}

function clearCurrentImageState(options: ClearImageOptions = {}): void {
  const skipSummary = options.skipSummary;

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

function getBatchQueueItems(): ResizeQueueItem[] {
  return batchQueue.slice();
}

function addFilesToQueue(entries: readonly FileEntry[], sourceLabel?: string): void {
  const source = sourceLabel || 'источника';
  const deduped = coreFiles.dedupeFileEntries(entries || []);
  const existingKeys = new Set(batchQueue.map((item) => item.key));

  let added = 0;
  let skipped = 0;
  let firstAdded: ResizeQueueItem | null = null;

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

function removeActiveQueueItem(): boolean {
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
  if (!nextItem) return false;
  batchActiveKey = nextItem.key;
  handleFile(nextItem.file);

  renderQueueList();
  updateQueueSummary();
  updateBatchButtons();
  return true;
}

function removeQueueItemByKey(key: string): boolean {
  if (!key || !batchQueue.length) return false;
  const index = batchQueue.findIndex((item) => item.key === key);
  if (index < 0) return false;

  const removed = batchQueue[index];
  if (!removed) return false;
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
    if (!nextItem) return false;
    batchActiveKey = nextItem.key;
    handleFile(nextItem.file);
  } else {
    renderQueueList();
    updateQueueSummary();
    updateBatchButtons();
  }

  return true;
}

function clearQueue(): void {
  batchQueue = [];
  batchActiveKey = '';
  clearCurrentImageState();
  renderQueueList();
  updateBatchButtons();
}

function selectQueueItemByKey(key: string): void {
  if (!key) return;
  const item = batchQueue.find((entry) => entry.key === key);
  if (!item) return;
  if (item.key === batchActiveKey) return;

  batchActiveKey = item.key;
  renderQueueList();
  updateQueueSummary();
  handleFile(item.file);
}

function computeTargetDimensions(image: HTMLImageElement, options: DimensionOptions = {}): TargetDimensions {
  const shouldUpdateInputs = options.updateInputs !== false;

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

function renderToCanvas(image: CanvasImageSource, canvas: HTMLCanvasElement, width: number, height: number): void {
  const ctx = canvasContext2d(canvas);
  canvas.width = width;
  canvas.height = height;

  const resample = elements.resampleSelect.value;
  if (resample === 'pixelated') {
    ctx.imageSmoothingEnabled = false;
    canvas.classList.add('pixelated');
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality =
      resample === 'low' || resample === 'medium' || resample === 'high' ? resample : 'high';
    canvas.classList.remove('pixelated');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
}

function scheduleRender(): void {
  if (!sourceImage) return;

  if (renderRequestId) {
    cancelAnimationFrame(renderRequestId);
  }

  renderRequestId = requestAnimationFrame(() => {
    renderRequestId = null;
    render();
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: OutputMime, quality?: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, mime, quality);
  });
}

async function canvasToOutputBlob(
  canvas: HTMLCanvasElement,
  preferredMime: OutputMime,
  quality?: number,
): Promise<OutputBlobResult> {
  const direct = await canvasToBlob(canvas, preferredMime, quality);
  if (direct) {
    const mime: OutputMime =
      direct.type === 'image/jpeg' || direct.type === 'image/webp' || direct.type === 'image/png'
        ? direct.type
        : preferredMime;
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

async function updateEstimate(width: number, height: number): Promise<void> {
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

function render(): void {
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

function primeDimensionsForImage(): void {
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

function handleFile(file: File): void {
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

    const image = elements.previewImg;
    sourceImage = image;
    sourceWidth = Math.max(1, image.naturalWidth || image.width || 1);
    sourceHeight = Math.max(1, image.naturalHeight || image.height || 1);

    primeDimensionsForImage();
    updateQueueSummary();
    render();
  });
}

function buildOutputFileName(fileName: string, mime: OutputMime): string {
  const base = coreFiles.baseName(fileName || 'image');
  const ext = mimeToExtension(mime);
  return `${base}-resized.${ext}`;
}

function buildZipEntryName(queueItem: ResizeQueueItem, mime: OutputMime): string {
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

async function createOutputBlobForFile(file: File): Promise<OutputBlobResult> {
  const image = await coreFiles.loadImageFromFile(file);
  const size = computeTargetDimensions(image, { updateInputs: false });
  const tempCanvas = document.createElement('canvas');

  renderToCanvas(image, tempCanvas, size.width, size.height);

  const mime = getOutputMimeForFile(file);
  const quality = getOutputQuality(mime);
  return canvasToOutputBlob(tempCanvas, mime, quality);
}

async function saveCurrentFile(): Promise<void> {
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
    alert(errorMessage(err, 'Не удалось сохранить файл.'));
  } finally {
    elements.saveBtn.textContent = originalLabel;
    updateSaveButtonLabel();
  }
}

async function saveZip(): Promise<void> {
  const queueItems = getBatchQueueItems();
  if (!queueItems.length) {
    alert('Очередь пуста. Добавьте файлы или папку.');
    return;
  }

  const originalLabel = elements.saveZipBtn.textContent;
  const entries: ZipEntry[] = [];
  const total = queueItems.length;
  let failed = 0;

  setBatchBusy(true);
  try {
    let index = 0;
    for (const queueItem of queueItems) {
      coreIngestUi.setZipButtonProgress(elements.saveZipBtn, index + 1, total);
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
      index += 1;
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

export {};
