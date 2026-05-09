import { canvasContext2d, errorMessage, requireElement } from '../../shared/js/dom.ts';

type PixelSource = HTMLImageElement | HTMLCanvasElement;
type RGB = readonly [number, number, number];
type Palette = readonly RGB[];
type PixelControlsSnapshot = {
  readonly pixelSize: string;
  readonly palette: string;
  readonly dither: string;
  readonly brightness: string;
  readonly contrast: string;
  readonly saturation: string;
  readonly noise: string;
  readonly scanlines: boolean;
  readonly preserveAlpha: boolean;
  readonly crtGlow: boolean;
  readonly pixelGrid: boolean;
  readonly alphaThreshold: boolean;
};
type PixelSavedState = {
  readonly isGif: false;
  readonly controls: PixelControlsSnapshot;
  readonly outputDataUrl: string;
};
type RetroQueueItem = FileEntry & {
  readonly key: string;
  savedState?: PixelSavedState | null;
};
type ClearImageOptions = {
  readonly skipSummary?: boolean;
};
type HandleFileOptions = {
  readonly restoreState?: PixelSavedState | null;
};
type RenderSize = {
  readonly width: number;
  readonly height: number;
};
type DitherKernel = readonly (readonly [number, number, number])[];

const imageInput = requireElement('imageInput', HTMLInputElement);
const folderInput = requireElement('folderInput', HTMLInputElement);
const dropZone = requireElement('dropZone', HTMLElement);
const dropZonePlaceholder = requireElement('dropZonePlaceholder', HTMLElement);
const originalPreview = requireElement('originalPreview', HTMLElement);
const previewImg = requireElement('previewImg', HTMLImageElement);
const removeBtn = requireElement('removeImage', HTMLButtonElement);
const pickFilesBtn = requireElement('pickFilesBtn', HTMLButtonElement);
const pickFolderBtn = requireElement('pickFolderBtn', HTMLButtonElement);
const clearQueueBtn = requireElement('clearQueueBtn', HTMLButtonElement);
const fileName = requireElement('fileName', HTMLElement);
const queueList = requireElement('queueList', HTMLElement);
const outputCanvas = requireElement('outputCanvas', HTMLCanvasElement);
const emptyState = requireElement('emptyState', HTMLElement);
const sizeLabel = requireElement('sizeLabel', HTMLElement);

const pixelSize = requireElement('pixelSize', HTMLInputElement);
const pixelValue = requireElement('pixelValue', HTMLElement);
const paletteSelect = requireElement('paletteSelect', HTMLSelectElement);
const ditherSelect = requireElement('ditherSelect', HTMLSelectElement);
const brightness = requireElement('brightness', HTMLInputElement);
const brightnessValue = requireElement('brightnessValue', HTMLElement);
const contrast = requireElement('contrast', HTMLInputElement);
const contrastValue = requireElement('contrastValue', HTMLElement);
const saturation = requireElement('saturation', HTMLInputElement);
const saturationValue = requireElement('saturationValue', HTMLElement);
const noise = requireElement('noise', HTMLInputElement);
const noiseValue = requireElement('noiseValue', HTMLElement);
const scanlines = requireElement('scanlines', HTMLInputElement);
const preserveAlpha = requireElement('preserveAlpha', HTMLInputElement);
const crtGlow = requireElement('crtGlow', HTMLInputElement);
const pixelGrid = requireElement('pixelGrid', HTMLInputElement);
const alphaThreshold = requireElement('alphaThreshold', HTMLInputElement);
const saveBtn = requireElement('saveBtn', HTMLButtonElement);
const saveZipBtn = requireElement('saveZipBtn', HTMLButtonElement);

const ctx = canvasContext2d(outputCanvas);
let sourceImage: HTMLImageElement | null = null;
let currentObjectUrl: string | null = null;

let isGif = false;
let gifLoopId: number | null = null;
let gifLastFrameTime = 0;
let gifFrames: GifFrame[] | null = null;
let gifFrameIndex = 0;
let gifFrameElapsed = 0;
let gifDecodeToken = 0;
let currentFile: File | null = null;
let currentFileName = '';
let renderRequestId: number | null = null;
let batchQueue: RetroQueueItem[] = [];
let batchActiveKey = '';
let batchBusy = false;

const effectBufferCanvas = document.createElement('canvas');
const effectBufferCtx = canvasContext2d(effectBufferCanvas);
const downscaleCanvas = document.createElement('canvas');
const downscaleCtx = canvasContext2d(downscaleCanvas, { willReadFrequently: true });
let ditherBuffer = new Float32Array(0);

const GIF_TARGET_FPS = 24;
const GIF_FRAME_INTERVAL = 1000 / GIF_TARGET_FPS;
const GIFUCT_JS_URL = '../../shared/vendor/gifuct.js';
const GIF_JS_URL = '../../shared/vendor/gif.js';
const GIF_WORKER_URL = '../../shared/vendor/gif.worker.js';

const previewModal = new PreviewModal();
const coreFiles = window.AppCore.files;
const coreZip = window.AppCore.zip;
const coreIngestUi = window.AppCore.ingestUi;
const corePreview = window.AppCore.preview;
const coreGifDecode = window.AppCore.gifDecode;
const coreGifEncode = window.AppCore.gifEncode;



const palettes: Record<string, Palette | null> = {
  original: null,
  gameboy: [
    [15, 56, 15],
    [48, 98, 48],
    [139, 172, 15],
    [155, 188, 15],
  ],
  cga: [
    [0, 0, 0],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ],
  pico8: [
    [0, 0, 0],
    [29, 43, 83],
    [126, 37, 83],
    [0, 135, 81],
    [171, 82, 54],
    [95, 87, 79],
    [194, 195, 199],
    [255, 241, 232],
    [255, 0, 77],
    [255, 163, 0],
    [255, 236, 39],
    [0, 228, 54],
    [41, 173, 255],
    [131, 118, 156],
    [255, 119, 168],
    [255, 204, 170],
  ],
  amber: [
    [20, 10, 0],
    [90, 40, 0],
    [255, 160, 40],
    [255, 220, 140],
  ],
  matrix: [
    [10, 4, 0],
    [64, 28, 0],
    [160, 74, 12],
    [249, 115, 22],
  ],
  mono: [
    [0, 0, 0],
    [85, 85, 85],
    [170, 170, 170],
    [255, 255, 255],
  ],
};

function looksLikeGif(file: File | null | undefined): boolean {
  const type = (file && file.type ? file.type : '').toLowerCase();
  if (type === 'image/gif') return true;
  const name = (file && file.name ? file.name : '').toLowerCase();
  return name.endsWith('.gif');
}

function loadGifFrames(file: File, token: number): Promise<GifFrame[] | null> {
  return coreGifDecode.loadGifFrames(file, token, {
    gifuctUrl: GIFUCT_JS_URL,
    frameInterval: GIF_FRAME_INTERVAL,
    isTokenValid: (t) => t === gifDecodeToken
  });
}

function setSaveButtonState(label: string, disabled: boolean): void {
  saveBtn.textContent = label;
  saveBtn.disabled = disabled;
}

function updateSaveButtonLabel(): void {
  if (!sourceImage) {
    setSaveButtonState('Сохранить PNG', true);
    return;
  }
  setSaveButtonState(isGif ? 'Сохранить GIF' : 'Сохранить PNG', false);
}

function normalizeQueuePath(file: File, relativePath?: string): string {
  return coreFiles.normalizePath(relativePath || file.webkitRelativePath || file.name) || file.name;
}

function makeQueueKey(file: File, relativePath?: string): string {
  return `${normalizeQueuePath(file, relativePath)}|${file.size}|${file.lastModified}`;
}

function renderQueueList(): void {
  coreIngestUi.renderQueue({
    queueList,
    items: batchQueue,
    isBusy: batchBusy,
    getItemId: (item) => item.key,
    isActive: (item) => item.key === batchActiveKey,
    getName: (item) => item.file.name || 'file',
    getPath: (item) => (item.relativePath && item.relativePath !== item.file.name ? item.relativePath : ''),
    getBadgeClass: (item) => {
      const hasSavedState = Boolean(item.savedState && !item.savedState.isGif);
      return item.key === batchActiveKey ? 'processing' : hasSavedState ? 'saved' : 'pending';
    },
    getBadgeText: (item) => {
      const hasSavedState = Boolean(item.savedState && !item.savedState.isGif);
      return item.key === batchActiveKey ? 'выбран' : hasSavedState ? 'сохранено' : 'новый';
    },
  });
}

function updateQueueSummary(): void {
  if (!batchQueue.length) {
    fileName.textContent = sourceImage ? currentFileName || 'Файл загружен' : 'Очередь пуста';
    return;
  }
  const activeItem = batchQueue.find((item) => item.key === batchActiveKey);
  const activeLabel = activeItem ? ` Выбран: ${activeItem.file.name}.` : '';
  fileName.textContent = `Файлов в очереди: ${batchQueue.length}.${activeLabel}`;
}

function updateBatchButtons(): void {
  coreIngestUi.updateIngestButtons({
    pickFilesBtn,
    pickFolderBtn,
    clearQueueBtn,
    fileInput: imageInput,
    folderInput,
    zipBtn: saveZipBtn,
    busy: batchBusy,
    queueLength: batchQueue.length,
  });
}

function setBatchBusy(isBusy: boolean): void {
  batchBusy = Boolean(isBusy);
  renderQueueList();
  updateBatchButtons();
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

function clearCurrentImageState(options: ClearImageOptions = {}): void {
  const skipSummary = options.skipSummary;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  resetGifState();
  isGif = false;
  currentFile = null;
  currentFileName = '';
  sourceImage = null;
  updateSaveButtonLabel();
  sizeLabel.textContent = '—';
  emptyState.style.display = 'grid';
  ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  imageInput.value = '';
  folderInput.value = '';
  clearPreview();
  if (previewModal.isOpen) {
    previewModal.close();
  }
  if (!skipSummary) {
    updateQueueSummary();
  }
}

function getBatchQueueItems(): RetroQueueItem[] {
  return batchQueue.slice();
}

function findQueueItemByKey(key: string): RetroQueueItem | null {
  return batchQueue.find((item) => item.key === key) || null;
}

function capturePixelControls(): PixelControlsSnapshot {
  return {
    pixelSize: String(pixelSize.value),
    palette: String(paletteSelect.value),
    dither: String(ditherSelect.value),
    brightness: String(brightness.value),
    contrast: String(contrast.value),
    saturation: String(saturation.value),
    noise: String(noise.value),
    scanlines: Boolean(scanlines.checked),
    preserveAlpha: Boolean(preserveAlpha.checked),
    crtGlow: Boolean(crtGlow.checked),
    pixelGrid: Boolean(pixelGrid.checked),
    alphaThreshold: Boolean(alphaThreshold.checked),
  };
}

function applyPixelControls(snapshot: PixelControlsSnapshot | null | undefined): void {
  if (!snapshot) return;
  if (snapshot.pixelSize !== undefined) pixelSize.value = snapshot.pixelSize;
  if (snapshot.palette !== undefined) paletteSelect.value = snapshot.palette;
  if (snapshot.dither !== undefined) ditherSelect.value = snapshot.dither;
  if (snapshot.brightness !== undefined) brightness.value = snapshot.brightness;
  if (snapshot.contrast !== undefined) contrast.value = snapshot.contrast;
  if (snapshot.saturation !== undefined) saturation.value = snapshot.saturation;
  if (snapshot.noise !== undefined) noise.value = snapshot.noise;
  scanlines.checked = Boolean(snapshot.scanlines);
  preserveAlpha.checked = Boolean(snapshot.preserveAlpha);
  crtGlow.checked = Boolean(snapshot.crtGlow);
  pixelGrid.checked = Boolean(snapshot.pixelGrid);
  alphaThreshold.checked = Boolean(snapshot.alphaThreshold);
}

function captureCurrentPixelState(): PixelSavedState | null {
  if (!sourceImage || !outputCanvas.width || !outputCanvas.height) {
    return null;
  }
  if (isGif) {
    return null;
  }

  return {
    isGif: false,
    controls: capturePixelControls(),
    outputDataUrl: outputCanvas.toDataURL('image/png'),
  };
}

function saveActiveQueueItemState(): void {
  const activeItem = findQueueItemByKey(batchActiveKey);
  if (!activeItem) return;
  const snapshot = captureCurrentPixelState();
  if (!snapshot) return;
  activeItem.savedState = snapshot;
}

function drawOutputCanvasFromDataUrl(dataUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!dataUrl) {
      resolve(false);
      return;
    }

    const image = new Image();
    image.onload = () => {
      outputCanvas.width = image.naturalWidth || image.width;
      outputCanvas.height = image.naturalHeight || image.height;
      const outputCtx = canvasContext2d(outputCanvas);
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      outputCtx.drawImage(image, 0, 0);
      sizeLabel.textContent = `${outputCanvas.width} x ${outputCanvas.height}`;
      emptyState.style.display = 'none';
      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}

async function restorePixelStateFromCache(state: PixelSavedState | null | undefined): Promise<boolean> {
  if (!state || state.isGif || !state.outputDataUrl) {
    return false;
  }

  applyPixelControls(state.controls);
  updateRangeDisplay();
  const restored = await drawOutputCanvasFromDataUrl(state.outputDataUrl);
  if (!restored) {
    return false;
  }

  isGif = false;
  updateSaveButtonLabel();
  if (previewModal.isOpen) {
    previewModal.update(outputCanvas);
  }
  return true;
}

function addFilesToQueue(entries: readonly FileEntry[], sourceLabel?: string): void {
  const source = sourceLabel || 'источника';
  const deduped = coreFiles.dedupeFileEntries(entries || []);
  const existingKeys = new Set(batchQueue.map((item) => item.key));

  let added = 0;
  let skipped = 0;
  let firstAdded: RetroQueueItem | null = null;

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
      savedState: null,
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
    if (batchActiveKey && batchActiveKey !== firstAdded.key) {
      saveActiveQueueItemState();
    }
    batchActiveKey = firstAdded.key;
    if (firstAdded.savedState && !firstAdded.savedState.isGif) {
      handleFile(firstAdded.file, { restoreState: firstAdded.savedState });
    } else {
      handleFile(firstAdded.file);
    }
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
  if (nextItem.savedState && !nextItem.savedState.isGif) {
    handleFile(nextItem.file, { restoreState: nextItem.savedState });
  } else {
    handleFile(nextItem.file);
  }
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
    if (nextItem.savedState && !nextItem.savedState.isGif) {
      handleFile(nextItem.file, { restoreState: nextItem.savedState });
    } else {
      handleFile(nextItem.file);
    }
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

  if (batchActiveKey) {
    saveActiveQueueItemState();
  }

  batchActiveKey = item.key;
  renderQueueList();
  updateQueueSummary();
  if (item.savedState && !item.savedState.isGif) {
    handleFile(item.file, { restoreState: item.savedState });
  } else {
    handleFile(item.file);
  }
}

function stopGifLoop(): void {
  if (gifLoopId) {
    cancelAnimationFrame(gifLoopId);
    gifLoopId = null;
  }
  gifLastFrameTime = 0;
}

function resetGifState(): void {
  stopGifLoop();
  gifFrames = null;
  gifFrameIndex = 0;
  gifFrameElapsed = 0;
  gifLastFrameTime = 0;
}

function renderGifFrame(frame: GifFrame): void {
  if (!frame || !frame.canvas) return;
  const size = renderToCanvas(frame.canvas, outputCanvas);
  if (size) {
    sizeLabel.textContent = `${size.width} x ${size.height}`;
  }
  emptyState.style.display = 'none';
  if (previewModal.isOpen) {
    previewModal.update(outputCanvas);
  }
}

function startGifLoop(): void {
  if (!isGif || !gifFrames || gifFrames.length === 0) return;
  stopGifLoop();

  gifFrameIndex = gifFrameIndex % gifFrames.length;
  gifFrameElapsed = 0;
  const initialFrame = gifFrames[gifFrameIndex];
  if (!initialFrame) return;
  renderGifFrame(initialFrame);

  const tick = (timestamp: number): void => {
    if (!isGif || !gifFrames || gifFrames.length === 0) {
      stopGifLoop();
      return;
    }

    if (!gifLastFrameTime) {
      gifLastFrameTime = timestamp;
    }

    let delta = timestamp - gifLastFrameTime;
    gifLastFrameTime = timestamp;
    if (delta < 0) delta = 0;
    gifFrameElapsed += delta;

    let safety = 0;
    while (safety < gifFrames.length * 2) {
      const currentFrame = gifFrames[gifFrameIndex];
      if (!currentFrame) break;
      const currentDelay = Math.max(currentFrame.delay || GIF_FRAME_INTERVAL, GIF_FRAME_INTERVAL);
      if (gifFrameElapsed < currentDelay) break;
      gifFrameElapsed -= currentDelay;
      gifFrameIndex = (gifFrameIndex + 1) % gifFrames.length;
      safety += 1;
    }

    const frame = gifFrames[gifFrameIndex];
    if (frame) {
      renderGifFrame(frame);
    }
    gifLoopId = requestAnimationFrame(tick);
  };

  gifLoopId = requestAnimationFrame(tick);
}

async function saveRetroGif(): Promise<void> {
  if (!isGif || !currentFile) {
    alert('Текущий файл не GIF.');
    return;
  }

  if (!gifFrames || gifFrames.length === 0) {
    try {
      const token = gifDecodeToken;
      const frames = await loadGifFrames(currentFile, token);
      if (token === gifDecodeToken && frames && frames.length) {
        gifFrames = frames;
      }
    } catch (err) {
      console.warn(err);
    }
  }

  if (!gifFrames || gifFrames.length === 0) {
    alert('Кадры GIF недоступны. Нужен ImageDecoder или gifuct.js.');
    return;
  }

  const previousLabel = saveBtn.textContent;
  const wasGifLoopRunning = !!gifLoopId;

  if (wasGifLoopRunning) {
    stopGifLoop();
  }

  setSaveButtonState('GIF 0%', true);

  try {
    const GIF = await coreGifEncode.loadGifJs(GIF_JS_URL);
    const encoder = new GIF({
      workers: Math.min(4, Math.max(2, navigator.hardwareConcurrency || 2)),
      quality: 10,
      workerScript: coreGifEncode.resolveWorkerScriptUrl(GIF_WORKER_URL),
      background: '#000',
      repeat: 0
    });

    const frameCanvases = gifFrames.map((frame) => renderFrameCanvas(frame.canvas));

    frameCanvases.forEach((canvas, index) => {
      const sourceFrame = gifFrames?.[index];
      if (!sourceFrame) return;
      encoder.addFrame(canvas, {
        delay: Math.round(sourceFrame.delay || GIF_FRAME_INTERVAL),
        copy: true
      });
    });

    encoder.on('progress', (progress) => {
      const percent = Math.round(progress * 100);
      setSaveButtonState(`GIF ${percent}%`, true);
    });

    encoder.on('finished', (blob) => {
      const baseName = currentFileName
        ? currentFileName.replace(/\\.[^.]+$/, '')
        : 'retro_pixel';
      const link = document.createElement('a');
      link.download = `${baseName}.gif`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);

      setSaveButtonState(previousLabel || 'Сохранить GIF', false);
      updateSaveButtonLabel();
      if (wasGifLoopRunning) startGifLoop();
    });

    encoder.render();
  } catch (err) {
    console.error(err);
    alert(errorMessage(err, 'Не удалось сохранить GIF.'));
    setSaveButtonState(previousLabel || 'Сохранить GIF', false);
    updateSaveButtonLabel();
    if (wasGifLoopRunning) startGifLoop();
  }
}

const bayer4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const DITHER_KERNELS: Record<string, DitherKernel> = {
  floyd: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
  jjn: [
    [1, 0, 7 / 48],
    [2, 0, 5 / 48],
    [-2, 1, 3 / 48],
    [-1, 1, 5 / 48],
    [0, 1, 7 / 48],
    [1, 1, 5 / 48],
    [2, 1, 3 / 48],
    [-2, 2, 1 / 48],
    [-1, 2, 3 / 48],
    [0, 2, 5 / 48],
    [1, 2, 3 / 48],
    [2, 2, 1 / 48],
  ],
};

const ORIGINAL_DITHER_LEVELS = 4;

function buildUniformPalette(levelsPerChannel: number): Palette {
  const palette: RGB[] = [];
  if (levelsPerChannel <= 1) {
    return [[0, 0, 0]];
  }

  const step = 255 / (levelsPerChannel - 1);
  for (let r = 0; r < levelsPerChannel; r += 1) {
    for (let g = 0; g < levelsPerChannel; g += 1) {
      for (let b = 0; b < levelsPerChannel; b += 1) {
        palette.push([
          Math.round(r * step),
          Math.round(g * step),
          Math.round(b * step),
        ]);
      }
    }
  }
  return palette;
}

const ORIGINAL_DITHER_PALETTE = buildUniformPalette(ORIGINAL_DITHER_LEVELS);

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function applyAdjustments(data: Uint8ClampedArray): void {
  const b = Number(brightness.value);
  const c = Number(contrast.value);
  const s = Number(saturation.value) / 100;

  const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] ?? 0;
    let g = data[i + 1] ?? 0;
    let bch = data[i + 2] ?? 0;

    r = contrastFactor * (r - 128) + 128 + b;
    g = contrastFactor * (g - 128) + 128 + b;
    bch = contrastFactor * (bch - 128) + 128 + b;

    const gray = 0.3 * r + 0.59 * g + 0.11 * bch;
    r = gray + (r - gray) * s;
    g = gray + (g - gray) * s;
    bch = gray + (bch - gray) * s;

    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(bch);
  }
}

function applyNoise(data: Uint8ClampedArray): void {
  const noiseAmount = Number(noise.value);
  if (noiseAmount > 0) {
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() * 2 - 1) * noiseAmount;
      data[i] = clamp((data[i] ?? 0) + n);
      data[i + 1] = clamp((data[i + 1] ?? 0) + n);
      data[i + 2] = clamp((data[i + 2] ?? 0) + n);
    }
  }
}

function applyScanlines(data: Uint8ClampedArray, width: number, height: number): void {
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      data[idx] = (data[idx] ?? 0) * 0.85;
      data[idx + 1] = (data[idx + 1] ?? 0) * 0.85;
      data[idx + 2] = (data[idx + 2] ?? 0) * 0.85;
    }
  }
}

function applyAlphaThreshold(data: Uint8ClampedArray): void {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = (data[i] ?? 0) >= 128 ? 255 : 0;
  }
}

function forceOpaqueAlpha(data: Uint8ClampedArray): void {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255;
  }
}

function ensureEffectBufferSize(width: number, height: number): void {
  if (effectBufferCanvas.width !== width || effectBufferCanvas.height !== height) {
    effectBufferCanvas.width = width;
    effectBufferCanvas.height = height;
  } else {
    effectBufferCtx.clearRect(0, 0, width, height);
  }
}

function applyCrtGlow(targetCtx: CanvasRenderingContext2D, width: number, height: number): void {
  ensureEffectBufferSize(width, height);
  effectBufferCtx.drawImage(targetCtx.canvas, 0, 0, width, height);

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'screen';
  targetCtx.globalAlpha = 0.24;
  targetCtx.filter = 'blur(1.8px)';
  targetCtx.drawImage(effectBufferCanvas, 0, 0, width, height);
  targetCtx.restore();
}

function drawPixelGrid(
  targetCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellsX: number,
  cellsY: number,
): void {
  if (cellsX < 2 && cellsY < 2) return;

  const stepX = width / cellsX;
  const stepY = height / cellsY;

  targetCtx.save();
  targetCtx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();

  for (let x = 1; x < cellsX; x += 1) {
    const px = Math.round(x * stepX) + 0.5;
    targetCtx.moveTo(px, 0);
    targetCtx.lineTo(px, height);
  }

  for (let y = 1; y < cellsY; y += 1) {
    const py = Math.round(y * stepY) + 0.5;
    targetCtx.moveTo(0, py);
    targetCtx.lineTo(width, py);
  }

  targetCtx.stroke();
  targetCtx.restore();
}

function findNearestColor(r: number, g: number, b: number, palette: Palette): RGB {
  let best: RGB = palette[0] ?? [0, 0, 0];
  let bestDist = Number.MAX_VALUE;
  for (const color of palette) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

function applyErrorDiffusionDither(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Palette,
  kernel: DitherKernel,
): void {
  const pixelCount = width * height;
  const requiredSize = pixelCount * 3;
  if (ditherBuffer.length < requiredSize) {
    ditherBuffer = new Float32Array(requiredSize);
  }
  const buffer = ditherBuffer;

  for (let src = 0, dst = 0; src < data.length; src += 4, dst += 3) {
    buffer[dst] = data[src] ?? 0;
    buffer[dst + 1] = data[src + 1] ?? 0;
    buffer[dst + 2] = data[src + 2] ?? 0;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const i4 = pixelIndex * 4;
      if ((data[i4 + 3] ?? 0) === 0) continue;

      const i3 = pixelIndex * 3;
      const r = clamp(buffer[i3] ?? 0);
      const g = clamp(buffer[i3 + 1] ?? 0);
      const b = clamp(buffer[i3 + 2] ?? 0);
      const [nr, ng, nb] = findNearestColor(r, g, b, palette);

      data[i4] = nr;
      data[i4 + 1] = ng;
      data[i4 + 2] = nb;

      const errR = r - nr;
      const errG = g - ng;
      const errB = b - nb;
      if (errR === 0 && errG === 0 && errB === 0) continue;

      for (const [dx, dy, weight] of kernel) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighborIndex = ny * width + nx;
        const n4 = neighborIndex * 4;
        if ((data[n4 + 3] ?? 0) === 0) continue;

        const n3 = neighborIndex * 3;
        buffer[n3] = (buffer[n3] ?? 0) + errR * weight;
        buffer[n3 + 1] = (buffer[n3 + 1] ?? 0) + errG * weight;
        buffer[n3 + 2] = (buffer[n3 + 2] ?? 0) + errB * weight;
      }
    }
  }
}

function applyPalette(data: Uint8ClampedArray, width: number, height: number): void {
  const paletteKey = paletteSelect.value;
  const dither = ditherSelect.value;
  let palette = palettes[paletteKey];

  if (!palette) {
    if (dither === 'none') return;
    palette = ORIGINAL_DITHER_PALETTE;
  }

  const errorDiffusionKernel = DITHER_KERNELS[dither];

  if (errorDiffusionKernel) {
    applyErrorDiffusionDither(data, width, height, palette, errorDiffusionKernel);
    return;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      let r = data[idx] ?? 0;
      let g = data[idx + 1] ?? 0;
      let b = data[idx + 2] ?? 0;

      if (dither === 'ordered') {
        const threshold = ((bayer4[y % 4]?.[x % 4] ?? 0) - 7.5) * 3;
        r = clamp(r + threshold);
        g = clamp(g + threshold);
        b = clamp(b + threshold);
      }

      const [nr, ng, nb] = findNearestColor(r, g, b, palette);
      data[idx] = nr;
      data[idx + 1] = ng;
      data[idx + 2] = nb;
    }
  }
}

function renderToCanvas(source: PixelSource, targetCanvas: HTMLCanvasElement): RenderSize | null {
  if (!source || !targetCanvas) return null;

  const maxDim = 1400;
  const pixel = Number(pixelSize.value);

  const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;

  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const smallWidth = Math.max(1, Math.round(targetWidth / pixel));
  const smallHeight = Math.max(1, Math.round(targetHeight / pixel));

  if (downscaleCanvas.width !== smallWidth || downscaleCanvas.height !== smallHeight) {
    downscaleCanvas.width = smallWidth;
    downscaleCanvas.height = smallHeight;
  } else {
    downscaleCtx.clearRect(0, 0, smallWidth, smallHeight);
  }

  downscaleCtx.imageSmoothingEnabled = true;
  downscaleCtx.drawImage(source, 0, 0, smallWidth, smallHeight);

  const smallImgData = downscaleCtx.getImageData(0, 0, smallWidth, smallHeight);
  const smallData = smallImgData.data;

  applyAdjustments(smallData);
  applyPalette(smallData, smallWidth, smallHeight);
  applyNoise(smallData);

  if (preserveAlpha.checked) {
    if (alphaThreshold.checked) {
      applyAlphaThreshold(smallData);
    }
  } else {
    forceOpaqueAlpha(smallData);
  }

  downscaleCtx.putImageData(smallImgData, 0, 0);

  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const targetCtx = canvasContext2d(targetCanvas);
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.clearRect(0, 0, targetWidth, targetHeight);
  targetCtx.drawImage(downscaleCanvas, 0, 0, targetWidth, targetHeight);

  if (scanlines.checked) {
    const targetImgData = targetCtx.getImageData(0, 0, targetWidth, targetHeight);
    applyScanlines(targetImgData.data, targetWidth, targetHeight);
    targetCtx.putImageData(targetImgData, 0, 0);
  }

  if (crtGlow.checked) {
    applyCrtGlow(targetCtx, targetWidth, targetHeight);
  }

  if (pixelGrid.checked) {
    drawPixelGrid(targetCtx, targetWidth, targetHeight, smallWidth, smallHeight);
  }

  return { width: targetWidth, height: targetHeight };
}

function renderFrameCanvas(source: PixelSource): HTMLCanvasElement {
  const frameCanvas = document.createElement('canvas');
  renderToCanvas(source, frameCanvas);
  return frameCanvas;
}

function render(): void {
  if (!sourceImage) return;

  if (isGif && gifFrames && gifFrames.length) {
    const frame = gifFrames[gifFrameIndex];
    if (frame) {
      renderGifFrame(frame);
    }
    return;
  }

  const size = renderToCanvas(sourceImage, outputCanvas);
  if (size) {
    sizeLabel.textContent = `${size.width} x ${size.height}`;
  }
  emptyState.style.display = 'none';

  if (previewModal.isOpen) {
    previewModal.update(outputCanvas);
  }
}

function scheduleRender(): void {
  if (renderRequestId !== null) return;
  renderRequestId = requestAnimationFrame(() => {
    renderRequestId = null;
    render();
  });
}

function showOriginalPreview(src: string, onload: () => void): void {
  corePreview.show({
    previewImg,
    originalPreview,
    placeholder: dropZonePlaceholder,
    src,
    onload
  });
}

function clearPreview(): void {
  corePreview.clear({
    previewImg,
    originalPreview,
    placeholder: dropZonePlaceholder
  });
}

function updateRangeDisplay(): void {
  pixelValue.textContent = `${pixelSize.value}px`;
  brightnessValue.textContent = brightness.value;
  contrastValue.textContent = contrast.value;
  saturationValue.textContent = `${saturation.value}%`;
  noiseValue.textContent = noise.value;
}

async function handleFile(file: File, options: HandleFileOptions = {}): Promise<void> {
  if (!file) return;
  const restoreState = options.restoreState ?? null;
  const isImage = file.type
    ? file.type.startsWith('image/')
    : coreFiles.isImageFile(file);
  if (!isImage) {
    alert('Пожалуйста, выберите изображение');
    return;
  }

  sourceImage = null;
  resetGifState();
  gifDecodeToken += 1;
  const token = gifDecodeToken;
  const gifCheckPromise = coreGifDecode.isGifFile(file).catch(() => false);
  const probableGif = looksLikeGif(file);

  isGif = false;
  currentFile = file;
  currentFileName = file.name || '';
  syncActiveQueueWithFile(file);
  updateSaveButtonLabel();

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  const objectUrl = URL.createObjectURL(file);
  currentObjectUrl = objectUrl;

  showOriginalPreview(objectUrl, async () => {
    if (token !== gifDecodeToken) return;
    sourceImage = previewImg;
    updateQueueSummary();

    if (restoreState && typeof restorePixelStateFromCache === 'function') {
      const restored = await restorePixelStateFromCache(restoreState);
      if (token !== gifDecodeToken) return;
      if (restored) {
        return;
      }
    }

    const renderedStaticPreview = !probableGif;

    if (renderedStaticPreview) {
      render();
    }

    const detectedGif = await gifCheckPromise;
    if (token !== gifDecodeToken) return;

    isGif = detectedGif;
    updateSaveButtonLabel();
    if (!renderedStaticPreview || isGif) {
      render();
    }

    if (isGif) {
      loadGifFrames(file, token).then((frames) => {
        if (token !== gifDecodeToken) return;
        gifFrames = frames;
        gifFrameIndex = 0;
        gifFrameElapsed = 0;
        startGifLoop();
      });
    }
  });
}

coreIngestUi.bindIngestControls({
  fileInput: imageInput,
  folderInput,
  dropZone,
  pickFilesBtn,
  pickFolderBtn,
  clearQueueBtn,
  ignoreSelector: '.icon-btn',
  isBusy: () => batchBusy,
  onEntries: (entries, sourceLabel) => {
    addFilesToQueue(entries, sourceLabel);
  },
  onFile: (file) => {
    void handleFile(file);
  },
  onClear: clearQueue,
});

[ pixelSize, paletteSelect, ditherSelect, brightness, contrast, saturation, noise, scanlines, preserveAlpha, crtGlow, pixelGrid, alphaThreshold ].forEach(
  (control) => {
    control.addEventListener('input', () => {
      updateRangeDisplay();
      scheduleRender();
    });
  }
);

function savePng(): void {
  const link = document.createElement('a');
  link.download = `retro-pixel-${Date.now()}.png`;
  link.href = outputCanvas.toDataURL('image/png');
  link.click();
}

async function createRetroPngBlobForFile(file: File): Promise<Blob> {
  const image = await coreFiles.loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  renderToCanvas(image, canvas);
  return coreZip.canvasToPngBlob(canvas);
}

function buildRetroZipEntryName(queueItem: RetroQueueItem): string {
  const tools = coreFiles;
  const relativePath = tools.normalizePath(queueItem.relativePath || queueItem.file.name);
  const segments = relativePath.split('/');
  if (segments.length > 1) {
    segments.pop();
  } else {
    segments.length = 0;
  }
  const dir = segments.join('/');
  const outputFileName = `${tools.baseName(queueItem.file.name)}-retro.png`;
  return dir ? tools.sanitizePath(`${dir}/${outputFileName}`) : tools.sanitizePath(outputFileName);
}

async function saveZip(): Promise<void> {
  const queueItems = getBatchQueueItems();
  if (!queueItems.length) {
    alert('Очередь пуста. Добавьте файлы или папку.');
    return;
  }

  const originalLabel = saveZipBtn.textContent;
  const entries: ZipEntry[] = [];
  const total = queueItems.length;
  let failed = 0;
  const wasGifLoopRunning = Boolean(gifLoopId);

  setBatchBusy(true);
  if (wasGifLoopRunning) {
    stopGifLoop();
  }
  try {
    let index = 0;
    for (const queueItem of queueItems) {
      coreIngestUi.setZipButtonProgress(saveZipBtn, index + 1, total);
      try {
        const pngBlob = await createRetroPngBlobForFile(queueItem.file);
        const bytes = new Uint8Array(await pngBlob.arrayBuffer());
        entries.push({
          name: buildRetroZipEntryName(queueItem),
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
    const zipName = `retro-batch-${coreZip.formatDateStamp(new Date())}.zip`;
    coreZip.triggerDownload(zipBlob, zipName);

    if (failed > 0) {
      alert(`Архив создан. Успешно: ${entries.length}, ошибок: ${failed}.`);
    }
  } finally {
    coreIngestUi.resetZipButtonLabel(saveZipBtn, originalLabel || 'Скачать все (.zip)');
    setBatchBusy(false);
    if (sourceImage) {
      scheduleRender();
    }
    if (wasGifLoopRunning && isGif) {
      startGifLoop();
    }
  }
}

coreIngestUi.bindQueueList({
  queueList,
  isBusy: () => batchBusy,
  onRemove: (key) => {
    removeQueueItemByKey(key);
  },
  onSelect: (key) => {
    selectQueueItemByKey(key);
  },
});

saveBtn.addEventListener('click', () => {
  if (!sourceImage) return;
  if (isGif) {
    saveRetroGif();
    return;
  }
  savePng();
});

saveZipBtn.addEventListener('click', () => {
  void saveZip();
});

removeBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (removeActiveQueueItem()) {
    return;
  }
  clearCurrentImageState();
});

updateRangeDisplay();
updateSaveButtonLabel();
renderQueueList();
updateQueueSummary();
updateBatchButtons();

outputCanvas.addEventListener('click', () => {
  if (!sourceImage || !outputCanvas.width || !outputCanvas.height) {
    alert('Сначала загрузите изображение!');
    return;
  }
  previewModal.open(outputCanvas);
});

export {};
