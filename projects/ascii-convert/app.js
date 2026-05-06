
let lastAscii = '';
let lastImageData = null;
let debounceTimer = null;
let currentImage = null;
let isGif = false;
let gifLoopId = null;
let gifLastFrameTime = 0;
let currentObjectUrl = null;
let gifFrames = null;
let gifFrameIndex = 0;
let gifFrameElapsed = 0;
let gifDecodeToken = 0;
let gifMode = 'none';
let currentFile = null;
let currentFileName = '';
let batchQueue = [];
let batchActiveKey = '';
let batchBusy = false;

const GIF_TARGET_FPS = 24;
const GIF_FRAME_INTERVAL = 1000 / GIF_TARGET_FPS;


const elements = {
  fileInput: document.getElementById('image-file'),
  folderInput: document.getElementById('folder-input'),
  pickFilesBtn: document.getElementById('pick-files-btn'),
  pickFolderBtn: document.getElementById('pick-folder-btn'),
  clearQueueBtn: document.getElementById('clear-queue-btn'),
  fileName: document.getElementById('file-name'),
  queueList: document.getElementById('queueList'),
  dropZone: document.getElementById('drop-zone'),
  dropZonePlaceholder: document.getElementById('drop-zone-placeholder'),
  originalPreview: document.getElementById('original-preview'),
  previewImg: document.getElementById('preview-img'),
  removeBtn: document.getElementById('remove-image'),
  widthInput: document.getElementById('width'),
  charsetSelect: document.getElementById('charset'),
  customCharsetInput: document.getElementById('custom-charset-input'),
  colorSelect: document.getElementById('text-color'),
  colorHint: document.getElementById('color-hint'),
  contrastCheck: document.getElementById('contrast-check'),
  ditherCheck: document.getElementById('dither-check'),
  asciiContainer: document.getElementById('ascii-container'),
  previewCanvas: document.getElementById('preview-canvas'),
  outputWrapper: document.querySelector('.output-wrapper'),
  btnSaveTxt: document.getElementById('save-txt-button'),
  btnSavePng: document.getElementById('save-png-button'),
  btnCopy: document.getElementById('copy-button'),
  btnSaveZip: document.getElementById('save-zip-button')
};

const DEFAULT_GIF_WIDTH = 100;
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


const CONTRAST_POOL = ' .:-=+*#%@MWXVB80░▒▓█▁▂▃▄▅▆▇';
const CONTRAST_LEVELS = 8;
const CHAR_BRIGHTNESS_FONT = '24px Consolas, "Courier New", monospace';
const charBrightnessCache = new Map();
let contrastOptimizedCharset = null;

const brightnessCanvas = document.createElement('canvas');
brightnessCanvas.width = 32;
brightnessCanvas.height = 32;
const brightnessCtx = brightnessCanvas.getContext('2d', { willReadFrequently: true });

function measureCharBrightness(char) {
  if (charBrightnessCache.has(char)) {
    return charBrightnessCache.get(char);
  }

  const size = brightnessCanvas.width;
  brightnessCtx.clearRect(0, 0, size, size);
  brightnessCtx.fillStyle = '#000';
  brightnessCtx.fillRect(0, 0, size, size);
  brightnessCtx.fillStyle = '#fff';
  brightnessCtx.font = CHAR_BRIGHTNESS_FONT;
  brightnessCtx.textBaseline = 'top';
  brightnessCtx.textAlign = 'left';
  brightnessCtx.fillText(char, 0, 0);

  const data = brightnessCtx.getImageData(0, 0, size, size).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i];
  }

  const avg = sum / (data.length / 4);
  charBrightnessCache.set(char, avg);
  return avg;
}

function buildContrastOptimizedCharset() {
  if (contrastOptimizedCharset) return contrastOptimizedCharset;

  const poolChars = Array.from(new Set(Array.from(CONTRAST_POOL)));
  const pool = poolChars.map((ch) => ({
    ch,
    brightness: measureCharBrightness(ch)
  }));

  pool.sort((a, b) => a.brightness - b.brightness);

  const count = Math.min(CONTRAST_LEVELS, pool.length);
  const used = new Set();
  const picked = [];
  const maxIdx = pool.length - 1;

  for (let i = 0; i < count; i++) {
    let idx = Math.round((i * maxIdx) / (count - 1));
    if (used.has(idx)) {
      let offset = 1;
      while (idx - offset >= 0 || idx + offset <= maxIdx) {
        if (idx - offset >= 0 && !used.has(idx - offset)) {
          idx = idx - offset;
          break;
        }
        if (idx + offset <= maxIdx && !used.has(idx + offset)) {
          idx = idx + offset;
          break;
        }
        offset++;
      }
    }
    if (!used.has(idx)) {
      used.add(idx);
      picked.push(pool[idx]);
    }
  }

  picked.sort((a, b) => a.brightness - b.brightness);
  contrastOptimizedCharset = picked.map((item) => item.ch).join('');
  return contrastOptimizedCharset;
}


function initPasteSupport() {
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        handleFile(blob);
        break;
      }
    }
  });
}


function stopGifLoop() {
  if (gifLoopId) {
    cancelAnimationFrame(gifLoopId);
    gifLoopId = null;
  }
  gifLastFrameTime = 0;
  gifFrameElapsed = 0;
}

function resetGifState() {
  stopGifLoop();
  gifFrames = null;
  gifFrameIndex = 0;
  gifFrameElapsed = 0;
  gifMode = 'none';
}

function updateSaveButtonLabel() {
  if (!elements.btnSavePng) return;
  elements.btnSavePng.textContent = isGif ? 'GIF' : 'PNG';
}

function loadGifFrames(file, token) {
  return coreGifDecode.loadGifFrames(file, token, {
    gifuctUrl: GIFUCT_JS_URL,
    frameInterval: GIF_FRAME_INTERVAL,
    isTokenValid: (t) => t === gifDecodeToken
  });
}

function startGifLoop() {
  stopGifLoop();
  if (!isGif) return;

  const hasFrames = gifFrames && gifFrames.length > 0;
  gifMode = hasFrames ? 'frames' : 'image';

  if (gifMode === 'frames') {
    performConversion(gifFrames[gifFrameIndex].canvas);
  } else if (currentImage) {
    performConversion(currentImage);
  }

  gifLastFrameTime = performance.now();
  gifFrameElapsed = 0;

  const loop = (time) => {
    if (!isGif) {
      gifLoopId = null;
      return;
    }
    const delta = time - gifLastFrameTime;
    gifLastFrameTime = time;
    gifFrameElapsed += delta;

    if (gifMode === 'frames' && gifFrames && gifFrames.length > 0) {
      let delay = gifFrames[gifFrameIndex].delay || GIF_FRAME_INTERVAL;
      let advanced = false;
      while (gifFrameElapsed >= delay) {
        gifFrameElapsed -= delay;
        gifFrameIndex = (gifFrameIndex + 1) % gifFrames.length;
        delay = gifFrames[gifFrameIndex].delay || GIF_FRAME_INTERVAL;
        advanced = true;
      }
      if (advanced) {
        performConversion(gifFrames[gifFrameIndex].canvas);
      }
    } else if (currentImage) {
      if (gifFrameElapsed >= GIF_FRAME_INTERVAL) {
        gifFrameElapsed = 0;
        performConversion(currentImage);
      }
    }

    gifLoopId = requestAnimationFrame(loop);
  };

  gifLoopId = requestAnimationFrame(loop);
}

function looksLikeGif(file) {
  const type = (file && file.type ? file.type : '').toLowerCase();
  if (type === 'image/gif') return true;
  const name = (file && file.name ? file.name : '').toLowerCase();
  return name.endsWith('.gif');
}

async function handleFile(file, options) {
  const isImage = file
    ? file.type
      ? file.type.startsWith('image/')
      : coreFiles.isImageFile(file)
    : false;
  if (!isImage) {
    alert('Пожалуйста, выберите изображение');
    return;
  }

  const restoreState = options && options.restoreState ? options.restoreState : null;

  resetGifState();
  gifDecodeToken += 1;
  const token = gifDecodeToken;
  const gifCheckPromise = coreGifDecode.isGifFile(file).catch(() => false);
  const probableGif = looksLikeGif(file);

  isGif = false;
  currentFile = file;
  currentFileName = file?.name || '';
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
    currentImage = elements.previewImg;

    if (restoreState) {
      const restored = await restoreAsciiStateFromCache(restoreState);
      if (token !== gifDecodeToken) return;
      if (restored) {
        isGif = false;
        updateSaveButtonLabel();
        return;
      }
    }

    const renderedStaticPreview = !probableGif;

    if (renderedStaticPreview) {
      performConversion(currentImage);
    }

    const detectedGif = await gifCheckPromise;
    if (token !== gifDecodeToken) return;

    isGif = detectedGif;
    updateSaveButtonLabel();

    if (isGif) {
      if (elements.widthInput) {
        elements.widthInput.value = String(DEFAULT_GIF_WIDTH);
      }
      startGifLoop();
      loadGifFrames(file, token).then((frames) => {
        if (token !== gifDecodeToken) return;
        gifFrames = frames;
        gifFrameIndex = 0;
        gifFrameElapsed = 0;
        startGifLoop();
      });
      return;
    }

    if (!renderedStaticPreview) {
      performConversion(currentImage);
    }
  });
}

function showOriginalPreview(src, onload) {
  corePreview.show({
    previewImg: elements.previewImg,
    originalPreview: elements.originalPreview,
    placeholder: elements.dropZonePlaceholder,
    src,
    onload
  });
}

function removeImage(e, options) {
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }

  const shouldSkipQueue = options && options.skipQueue;
  if (!shouldSkipQueue && removeActiveQueueItem()) {
    return;
  }

  resetGifState();
  isGif = false;
  currentFile = null;
  currentFileName = '';
  updateSaveButtonLabel();
  gifDecodeToken++;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  currentImage = null;
  lastAscii = '';
  lastImageData = null;
  corePreview.clear({
    previewImg: elements.previewImg,
    originalPreview: elements.originalPreview,
    placeholder: elements.dropZonePlaceholder
  });
  elements.asciiContainer.textContent = '';
  elements.previewCanvas.style.display = 'none';
  elements.fileInput.value = '';
  if (elements.folderInput) {
    elements.folderInput.value = '';
  }
}


function normalizeQueuePath(file, relativePath) {
  return coreFiles.normalizePath(relativePath || file.webkitRelativePath || file.name) || file.name;
}

function makeQueueKey(file, relativePath) {
  const normalized = normalizeQueuePath(file, relativePath);
  return `${normalized}|${file.size}|${file.lastModified}`;
}

function renderQueueList() {
  if (!elements.queueList) return;
  coreIngestUi.renderQueue({
    queueList: elements.queueList,
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

function updateQueueSummary() {
  if (!elements.fileName) return;
  if (!batchQueue.length) {
    elements.fileName.textContent = 'Очередь пуста';
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
    fileInput: elements.fileInput,
    folderInput: elements.folderInput,
    zipBtn: elements.btnSaveZip,
    busy: batchBusy,
    queueLength: batchQueue.length,
  });
}

function setBatchBusy(isBusy) {
  batchBusy = Boolean(isBusy);
  renderQueueList();
  updateBatchButtons();
}

function syncActiveQueueWithFile(file) {
  if (!file || !batchQueue.length) return;
  const matched = batchQueue.find((item) => item.file === file);
  if (matched) {
    batchActiveKey = matched.key;
  }
  renderQueueList();
  updateQueueSummary();
}

function getBatchQueueItems() {
  return batchQueue.slice();
}

function findQueueItemByKey(key) {
  return batchQueue.find((item) => item.key === key) || null;
}

function captureAsciiControls() {
  return {
    width: elements.widthInput ? String(elements.widthInput.value) : '200',
    charset: elements.charsetSelect ? String(elements.charsetSelect.value) : ' .:-=+*iItVYXRBM#',
    customCharset: elements.customCharsetInput ? String(elements.customCharsetInput.value || '') : '',
    color: elements.colorSelect ? String(elements.colorSelect.value) : 'original',
    contrast: Boolean(elements.contrastCheck && elements.contrastCheck.checked),
    dither: Boolean(elements.ditherCheck && elements.ditherCheck.checked),
  };
}

function applyAsciiControls(snapshot) {
  if (!snapshot) return;

  if (elements.widthInput && snapshot.width) {
    elements.widthInput.value = snapshot.width;
  }
  if (elements.charsetSelect && snapshot.charset) {
    elements.charsetSelect.value = snapshot.charset;
  }
  if (elements.customCharsetInput) {
    elements.customCharsetInput.value = snapshot.customCharset || '';
    elements.customCharsetInput.style.display =
      elements.charsetSelect && elements.charsetSelect.value === 'custom' ? 'block' : 'none';
  }
  if (elements.colorSelect && snapshot.color) {
    elements.colorSelect.value = snapshot.color;
  }
  if (elements.contrastCheck) {
    elements.contrastCheck.checked = Boolean(snapshot.contrast);
  }
  if (elements.ditherCheck) {
    elements.ditherCheck.checked = Boolean(snapshot.dither);
  }
}

function captureCurrentAsciiState() {
  if (!currentImage || !lastAscii) {
    return null;
  }
  if (isGif) {
    return null;
  }

  const mode = elements.colorSelect ? elements.colorSelect.value : 'original';
  let previewDataUrl = '';
  if (mode === 'original' && elements.previewCanvas && elements.previewCanvas.width && elements.previewCanvas.height) {
    previewDataUrl = elements.previewCanvas.toDataURL('image/png');
  }

  return {
    isGif: false,
    mode,
    controls: captureAsciiControls(),
    lastAscii,
    lastImageData: lastImageData
      ? {
          width: lastImageData.width,
          height: lastImageData.height,
          data: new Uint8ClampedArray(lastImageData.data),
        }
      : null,
    previewDataUrl,
  };
}

function saveActiveQueueItemState() {
  const activeItem = findQueueItemByKey(batchActiveKey);
  if (!activeItem) return;
  const snapshot = captureCurrentAsciiState();
  if (!snapshot) return;
  activeItem.savedState = snapshot;
}

function drawPreviewCanvasFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || !elements.previewCanvas) {
      resolve(false);
      return;
    }

    const image = new Image();
    image.onload = () => {
      elements.previewCanvas.width = image.naturalWidth || image.width;
      elements.previewCanvas.height = image.naturalHeight || image.height;
      const ctxPreview = elements.previewCanvas.getContext('2d');
      ctxPreview.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
      ctxPreview.drawImage(image, 0, 0);
      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}

async function restoreAsciiStateFromCache(state) {
  if (!state || state.isGif || !state.lastAscii) {
    return false;
  }

  applyAsciiControls(state.controls);
  lastAscii = state.lastAscii;
  lastImageData = state.lastImageData
    ? {
        width: state.lastImageData.width,
        height: state.lastImageData.height,
        data: new Uint8ClampedArray(state.lastImageData.data),
      }
    : null;

  if (state.mode === 'original') {
    const restored = await drawPreviewCanvasFromDataUrl(state.previewDataUrl);
    if (!restored) {
      return false;
    }
    elements.asciiContainer.style.display = 'none';
    elements.previewCanvas.style.display = 'block';
    elements.colorHint.style.display = 'none';
    fitCanvasToScreen();
    if (previewModal.isOpen) {
      previewModal.update(elements.previewCanvas);
    }
    return true;
  }

  const color = state.mode || '#F97316';
  elements.previewCanvas.style.display = 'none';
  elements.asciiContainer.style.display = 'block';
  elements.colorHint.style.display = 'inline';
  elements.asciiContainer.textContent = lastAscii;
  elements.asciiContainer.style.color = color;

  fitAsciiToScreen();
  if (previewModal.isOpen) {
    previewModal.update(buildAsciiCanvasFromText(color));
  }
  return true;
}

function addFilesToQueue(entries, sourceLabel) {
  const source = sourceLabel || 'источника';
  const dedupedEntries = coreFiles.dedupeFileEntries(entries || []);
  const existingKeys = new Set(batchQueue.map((item) => item.key));

  let added = 0;
  let skipped = 0;
  let firstAdded = null;

  for (const entry of dedupedEntries) {
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

    const queueItem = {
      file: entry.file,
      relativePath: normalizedPath,
      key,
      savedState: null,
    };

    if (!firstAdded) {
      firstAdded = queueItem;
    }

    batchQueue.push(queueItem);
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
    removeImage(null, { skipQueue: true });
    renderQueueList();
    updateQueueSummary();
    updateBatchButtons();
    return true;
  }

  const nextIndex = Math.min(index, batchQueue.length - 1);
  const nextItem = batchQueue[nextIndex];
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

function removeQueueItemByKey(key) {
  if (!key || !batchQueue.length) return false;
  const index = batchQueue.findIndex((item) => item.key === key);
  if (index < 0) return false;

  const removed = batchQueue[index];
  batchQueue.splice(index, 1);

  if (!batchQueue.length) {
    batchActiveKey = '';
    removeImage(null, { skipQueue: true });
    renderQueueList();
    updateQueueSummary();
    updateBatchButtons();
    return true;
  }

  if (removed.key === batchActiveKey) {
    const nextIndex = Math.min(index, batchQueue.length - 1);
    const nextItem = batchQueue[nextIndex];
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

function clearQueue() {
  if (!batchQueue.length) return;
  batchQueue = [];
  batchActiveKey = '';
  removeImage(null, { skipQueue: true });
  renderQueueList();
  updateQueueSummary();
  updateBatchButtons();
}

function selectQueueItemByKey(key) {
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

function initBatchQueue() {
  coreIngestUi.bindIngestControls({
    fileInput: elements.fileInput,
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

  renderQueueList();
  updateQueueSummary();
  updateBatchButtons();
}


const hiddenCanvas = document.createElement('canvas');
const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const ASCII_ASPECT_RATIO = 0.68;
const ASCII_FONT_SIZE = 10;
const ASCII_FONT = `${ASCII_FONT_SIZE}px Consolas, "Courier New", monospace`;
const asciiMeasureCtx = document.createElement('canvas').getContext('2d');
asciiMeasureCtx.font = ASCII_FONT;
const ASCII_CHAR_WIDTH = asciiMeasureCtx.measureText('X').width;

function applyHistogramEqualization(data) {
  const histogram = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    histogram[luma]++;
  }

  const lumaLUT = new Uint8Array(256);
  let sum = 0;
  const totalPixels = data.length / 4;

  for (let i = 0; i < 256; i++) {
    sum += histogram[i];
    lumaLUT[i] = Math.round((sum / totalPixels) * 255);
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const newLuma = lumaLUT[luma];
    const ratio = luma ? (newLuma / luma) : 1;

    data[i] = Math.min(255, Math.max(0, r * ratio));
    data[i + 1] = Math.min(255, Math.max(0, g * ratio));
    data[i + 2] = Math.min(255, Math.max(0, b * ratio));
  }
}

function imageToAscii(img, width, charSet) {
  const newHeight = Math.round((img.height * (width / img.width)) * ASCII_ASPECT_RATIO);

  hiddenCanvas.width = width;
  hiddenCanvas.height = newHeight;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, newHeight);

  const rawData = ctx.getImageData(0, 0, width, newHeight);
  const data = new Uint8ClampedArray(rawData.data);

  lastImageData = {
    width,
    height: newHeight,
    data: new Uint8ClampedArray(rawData.data)
  };

  if (elements.contrastCheck.checked) {
    applyHistogramEqualization(data);
  }

  const grayData = new Float32Array(width * newHeight);

  for (let i = 0; i < data.length / 4; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    grayData[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  let resolvedCharset = charSet;
  if (charSet === 'contrast-optimized') {
    resolvedCharset = buildContrastOptimizedCharset();
  }

  const chars = Array.from(resolvedCharset);
  const maxCharIdx = chars.length - 1;

  if (elements.ditherCheck.checked) {
    applyFloydSteinbergDithering(grayData, width, newHeight, maxCharIdx);
  }

  return convertToAsciiString(grayData, width, newHeight, chars, maxCharIdx);
}

function applyFloydSteinbergDithering(grayData, width, height, maxCharIdx) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const oldPixel = grayData[i];
      const charIndex = Math.round((oldPixel / 255) * maxCharIdx);
      const newPixel = (charIndex / maxCharIdx) * 255;
      const quantError = oldPixel - newPixel;

      if (x + 1 < width) {
        grayData[y * width + (x + 1)] += quantError * 0.4375;
      }
      if (y + 1 < height) {
        if (x - 1 >= 0) {
          grayData[(y + 1) * width + (x - 1)] += quantError * 0.1875;
        }
        grayData[(y + 1) * width + x] += quantError * 0.3125;
        if (x + 1 < width) {
          grayData[(y + 1) * width + (x + 1)] += quantError * 0.0625;
        }
      }
    }
  }
}

function convertToAsciiString(grayData, width, height, chars, maxCharIdx) {
  const rows = [];

  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const val = Math.max(0, Math.min(255, grayData[i]));
      const charIdx = Math.floor((val / 255) * maxCharIdx);
      row += chars[charIdx];
    }
    rows.push(row);
  }

  return rows.join('\n');
}


function fitAsciiToScreen() {
  if (elements.asciiContainer.style.display === 'none' || !lastAscii) return;

  elements.asciiContainer.style.transform = 'none';

  requestAnimationFrame(() => {
    const containerRect = elements.outputWrapper.getBoundingClientRect();
    const contentRect = elements.asciiContainer.getBoundingClientRect();

    const availableWidth = containerRect.width;
    const contentWidth = contentRect.width;

    if (contentWidth > availableWidth) {
      const scale = availableWidth / contentWidth;
      elements.asciiContainer.style.transform = `scale(${scale})`;
      elements.asciiContainer.style.transformOrigin = 'top left';
    }
  });
}

function fitCanvasToScreen() {
  if (elements.previewCanvas.style.display === 'none') return;

  elements.previewCanvas.style.transform = 'none';

  requestAnimationFrame(() => {
    const containerRect = elements.outputWrapper.getBoundingClientRect();
    const canvasWidth = elements.previewCanvas.width;
    const availableWidth = containerRect.width;

    if (canvasWidth > availableWidth) {
      const scale = availableWidth / canvasWidth;
      elements.previewCanvas.style.transform = `scale(${scale})`;
      elements.previewCanvas.style.transformOrigin = 'top left';
    }
  });
}

function renderColorPreview() {
  if (!lastAscii || !lastImageData) return;

  const lines = lastAscii.split('\n');
  const widthPx = Math.ceil(lastImageData.width * ASCII_CHAR_WIDTH);
  const heightPx = lines.length * ASCII_FONT_SIZE;
  elements.previewCanvas.width = widthPx;
  elements.previewCanvas.height = heightPx;

  const ctxPreview = elements.previewCanvas.getContext('2d');
  ctxPreview.imageSmoothingEnabled = false;
  ctxPreview.fillStyle = '#000';
  ctxPreview.fillRect(0, 0, widthPx, heightPx);
  ctxPreview.font = ASCII_FONT;
  ctxPreview.textBaseline = 'top';
  ctxPreview.textAlign = 'left';

  const data = lastImageData.data;
  const imgW = lastImageData.width;

  for (let y = 0; y < lines.length; y++) {
    const line = lines[y];
    for (let x = 0; x < line.length; x++) {
      const i = (y * imgW + x) * 4;
      if (i < data.length) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        ctxPreview.fillStyle = `rgb(${r},${g},${b})`;
        ctxPreview.fillText(line[x], x * ASCII_CHAR_WIDTH, y * ASCII_FONT_SIZE);
      }
    }
  }
}

function updateDisplayMode() {
  const color = elements.colorSelect.value;

  if (color === 'original') {
    elements.asciiContainer.style.display = 'none';
    elements.previewCanvas.style.display = 'block';
    elements.colorHint.style.display = 'none';
    renderColorPreview();
    fitCanvasToScreen();
  } else {
    elements.previewCanvas.style.display = 'none';
    elements.asciiContainer.style.display = 'block';
    elements.colorHint.style.display = 'inline';
    elements.asciiContainer.textContent = lastAscii;
    elements.asciiContainer.style.color = color;
    fitAsciiToScreen();
  }
}


function renderAsciiToCanvas(asciiText, color) {
  const lines = asciiText.split('\n');
  const lineWidth = lines.length > 0 ? lines[0].length : 0;

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  const widthPx = Math.ceil(lineWidth * ASCII_CHAR_WIDTH);
  const heightPx = lines.length * ASCII_FONT_SIZE;

  tempCanvas.width = widthPx;
  tempCanvas.height = heightPx;

  tempCtx.imageSmoothingEnabled = false;
  tempCtx.fillStyle = '#000';
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.fillStyle = color;
  tempCtx.font = ASCII_FONT;
  tempCtx.textBaseline = 'top';
  tempCtx.textAlign = 'left';

  lines.forEach((line, i) => {
    tempCtx.fillText(line, 0, i * ASCII_FONT_SIZE);
  });

  return tempCanvas;
}

function cloneCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function buildAsciiCanvasFromText(color) {
  return renderAsciiToCanvas(lastAscii, color);
}

function renderColoredAsciiFrame(asciiText, imageData) {
  const lines = asciiText.split('\n');
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  const widthPx = Math.ceil(imageData.width * ASCII_CHAR_WIDTH);
  const heightPx = lines.length * ASCII_FONT_SIZE;

  tempCanvas.width = widthPx;
  tempCanvas.height = heightPx;

  tempCtx.imageSmoothingEnabled = false;
  tempCtx.fillStyle = '#000';
  tempCtx.fillRect(0, 0, widthPx, heightPx);
  tempCtx.font = ASCII_FONT;
  tempCtx.textBaseline = 'top';
  tempCtx.textAlign = 'left';

  const data = imageData.data;
  const imgW = imageData.width;

  for (let y = 0; y < lines.length; y++) {
    const line = lines[y];
    const maxX = Math.min(line.length, imgW);
    for (let x = 0; x < maxX; x++) {
      const i = (y * imgW + x) * 4;
      if (i < data.length) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        tempCtx.fillStyle = `rgb(${r},${g},${b})`;
        tempCtx.fillText(line[x], x * ASCII_CHAR_WIDTH, y * ASCII_FONT_SIZE);
      }
    }
  }

  return tempCanvas;
}

function setGifSaveUiState(label, disabled) {
  if (!elements.btnSavePng) return;
  elements.btnSavePng.textContent = label;
  elements.btnSavePng.disabled = disabled;
}

async function saveAsciiGif() {
  if (!isGif) {
    alert('Текущий файл не GIF.');
    return;
  }

  if (!gifFrames || gifFrames.length === 0) {
    if (currentFile) {
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
  }

  if (!gifFrames || gifFrames.length === 0) {
    alert('Кадры GIF недоступны. Нужен ImageDecoder или ../../shared/vendor/gifuct.js');
    return;
  }

  const width = parseInt(elements.widthInput.value, 10);
  if (isNaN(width) || width < 10) {
    alert('Некорректная ширина.');
    return;
  }

  const color = elements.colorSelect.value;
  const charset = getCharSetValue();
  const previousLabel = elements.btnSavePng ? elements.btnSavePng.textContent : 'GIF';
  const wasGifLoopRunning = !!gifLoopId;

  if (wasGifLoopRunning) {
    stopGifLoop();
  }

  setGifSaveUiState('GIF 0%', true);

  const previousImageData = lastImageData;

  try {
    const frameCanvases = [];
    const frameDelays = [];

    for (const frame of gifFrames) {
      const asciiText = imageToAscii(frame.canvas, width, charset);
      const canvas = color === 'original'
        ? renderColoredAsciiFrame(asciiText, lastImageData)
        : renderAsciiToCanvas(asciiText, color);
      frameCanvases.push(canvas);
      frameDelays.push(Math.round(frame.delay || GIF_FRAME_INTERVAL));
    }

    lastImageData = previousImageData;

    const GIF = await coreGifEncode.loadGifJs(GIF_JS_URL);
    const encoder = new GIF({
      workers: Math.min(4, Math.max(2, navigator.hardwareConcurrency || 2)),
      quality: 10,
      workerScript: coreGifEncode.resolveWorkerScriptUrl(GIF_WORKER_URL),
      background: '#000',
      repeat: 0
    });

    frameCanvases.forEach((canvas, index) => {
      encoder.addFrame(canvas, {
        delay: frameDelays[index],
        copy: true
      });
    });

    encoder.on('progress', (progress) => {
      const percent = Math.round(progress * 100);
      setGifSaveUiState(`GIF ${percent}%`, true);
    });

    encoder.on('finished', (blob) => {
      const baseName = currentFileName
        ? currentFileName.replace(/\.[^.]+$/, '')
        : 'ascii_art';
      const link = document.createElement('a');
      link.download = `${baseName}.gif`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);

      setGifSaveUiState(previousLabel || 'GIF', false);
      if (wasGifLoopRunning) startGifLoop();
    });

    encoder.render();
  } catch (err) {
    console.error(err);
    alert(err && err.message ? err.message : 'Не удалось сохранить GIF.');
    setGifSaveUiState(previousLabel || 'GIF', false);
    if (wasGifLoopRunning) startGifLoop();
  } finally {
    lastImageData = previousImageData;
  }
}


function saveTxt() {
  if (!lastAscii) {
    alert('Нет данных для сохранения!');
    return;
  }

  const blob = new Blob([lastAscii], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'ascii_art.txt';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function getCharSetValue() {
  let charSetVal = elements.charsetSelect.value;
  if (charSetVal === 'custom') {
    charSetVal = elements.customCharsetInput.value || ' .#';
  }
  return charSetVal;
}

function getOutputCanvas() {
  const color = elements.colorSelect.value;
  if (color === 'original') {
    return elements.previewCanvas;
  }
  return renderAsciiToCanvas(lastAscii, color);
}

async function savePng() {
  if (isGif) {
    await saveAsciiGif();
    return;
  }

  if (!lastAscii) {
    alert('Нет данных для сохранения!');
    return;
  }

  const canvas = getOutputCanvas();
  const link = document.createElement('a');
  link.download = 'ascii_art.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function copyToClipboard() {
  if (!lastAscii) {
    alert('Нет данных для копирования.');
    return;
  }

  try {
    const canvas = getOutputCanvas();
    await copyPngToClipboard(canvas);

    elements.btnCopy.textContent = 'DONE!';
    setTimeout(() => {
      elements.btnCopy.textContent = 'КОП.';
    }, 3000);
  } catch (err) {
    alert('Не удалось скопировать в буфер обмена.');
    console.error(err);
  }
}

async function copyTextToClipboard() {
  const text = elements.asciiContainer.textContent || elements.asciiContainer.innerText || '';

  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function copyPngToClipboard(canvas) {
  const blob = await new Promise(resolve => {
    canvas.toBlob(resolve, 'image/png');
  });

  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': blob
    })
  ]);
}

function renderColorAsciiCanvas(asciiText, imageData) {
  const safeAscii = String(asciiText || '');
  const safeImageData = imageData || {};
  const lines = safeAscii.split('\n');
  const width = safeImageData.width || 0;
  const data = safeImageData.data || new Uint8ClampedArray(0);

  const widthPx = Math.ceil(width * ASCII_CHAR_WIDTH);
  const heightPx = lines.length * ASCII_FONT_SIZE;
  const canvas = document.createElement('canvas');
  const ctxPreview = canvas.getContext('2d');

  canvas.width = Math.max(1, widthPx);
  canvas.height = Math.max(1, heightPx);
  ctxPreview.imageSmoothingEnabled = false;
  ctxPreview.fillStyle = '#000';
  ctxPreview.fillRect(0, 0, canvas.width, canvas.height);
  ctxPreview.font = ASCII_FONT;
  ctxPreview.textBaseline = 'top';
  ctxPreview.textAlign = 'left';

  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y];
    for (let x = 0; x < line.length; x += 1) {
      const i = (y * width + x) * 4;
      if (i >= data.length) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      ctxPreview.fillStyle = `rgb(${r},${g},${b})`;
      ctxPreview.fillText(line[x], x * ASCII_CHAR_WIDTH, y * ASCII_FONT_SIZE);
    }
  }

  return canvas;
}

function buildAsciiZipEntryName(queueItem) {
  const tools = coreFiles;
  const relativePath = tools.normalizePath(queueItem.relativePath || queueItem.file.name);
  const segments = relativePath.split('/');
  if (segments.length > 1) {
    segments.pop();
  } else {
    segments.length = 0;
  }
  const dir = segments.join('/');
  const outputFileName = `${tools.baseName(queueItem.file.name)}-ascii.png`;
  return dir ? tools.sanitizePath(`${dir}/${outputFileName}`) : tools.sanitizePath(outputFileName);
}

async function createAsciiPngBlobForFile(file) {
  const width = parseInt(elements.widthInput.value, 10);
  if (!Number.isFinite(width) || width < 10) {
    throw new Error('Некорректная ширина конвертации.');
  }

  const image = await coreFiles.loadImageFromFile(file);
  const asciiText = imageToAscii(image, width, getCharSetValue());
  const imageDataSnapshot = lastImageData;
  const color = elements.colorSelect.value;
  const canvas =
    color === 'original'
      ? renderColorAsciiCanvas(asciiText, imageDataSnapshot)
      : renderAsciiToCanvas(asciiText, color);

  return coreZip.canvasToPngBlob(canvas);
}

async function saveZip() {
  const queueItems = getBatchQueueItems();
  if (!queueItems.length) {
    alert('Очередь пуста. Добавьте файлы или папку.');
    return;
  }

  const originalLabel = elements.btnSaveZip ? elements.btnSaveZip.textContent : '';
  const total = queueItems.length;
  const entries = [];
  let failed = 0;
  const wasGifLoopRunning = Boolean(gifLoopId);

  setBatchBusy(true);
  if (wasGifLoopRunning) {
    stopGifLoop();
  }

  try {
    for (let i = 0; i < queueItems.length; i += 1) {
      const queueItem = queueItems[i];
      coreIngestUi.setZipButtonProgress(elements.btnSaveZip, i + 1, total);

      try {
        const pngBlob = await createAsciiPngBlobForFile(queueItem.file);
        const bytes = new Uint8Array(await pngBlob.arrayBuffer());
        entries.push({
          name: buildAsciiZipEntryName(queueItem),
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
    const zipName = `ascii-batch-${coreZip.formatDateStamp(new Date())}.zip`;
    coreZip.triggerDownload(zipBlob, zipName);

    if (failed > 0) {
      alert(`Архив создан. Успешно: ${entries.length}, ошибок: ${failed}.`);
    }
  } finally {
    coreIngestUi.resetZipButtonLabel(elements.btnSaveZip, originalLabel || 'Скачать все (.zip)');
    setBatchBusy(false);
    if (currentImage) {
      performConversion(currentImage);
    }
    if (wasGifLoopRunning && isGif) {
      startGifLoop();
    }
  }
}

function openPreviewFromCurrentOutput() {
  const color = elements.colorSelect.value;

  if (!lastAscii) {
    alert('Сначала загрузите изображение!');
    return;
  }

  let asciiCanvas;
  if (color === 'original') {
    asciiCanvas = cloneCanvas(elements.previewCanvas);
  } else {
    asciiCanvas = buildAsciiCanvasFromText(color);
  }

  previewModal.open(asciiCanvas);
}


function performConversion(img = currentImage) {
  if (!img) return;

  const width = parseInt(elements.widthInput.value, 10);
  if (isNaN(width) || width < 10) return;

  lastAscii = imageToAscii(img, width, getCharSetValue());
  updateDisplayMode();

  if (previewModal.isOpen) {
    const color = elements.colorSelect.value;
    let asciiCanvas;
    if (color === 'original') {
      asciiCanvas = elements.previewCanvas;
    } else {
      asciiCanvas = buildAsciiCanvasFromText(color);
    }
    previewModal.update(asciiCanvas);
  }
}

function requestUpdate() {
  if (isGif) {
    if (gifMode === 'frames' && gifFrames && gifFrames.length > 0) {
      performConversion(gifFrames[gifFrameIndex].canvas);
    } else if (currentImage) {
      performConversion(currentImage);
    }
    gifLastFrameTime = 0;
    gifFrameElapsed = 0;
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => performConversion(), 300);
}

function handleCharsetChange() {
  if (elements.charsetSelect.value === 'custom') {
    elements.customCharsetInput.style.display = 'block';
    elements.customCharsetInput.focus();
  } else {
    elements.customCharsetInput.style.display = 'none';
    performConversion();
  }
}


initPasteSupport();
initBatchQueue();

elements.removeBtn.addEventListener('click', removeImage);
elements.widthInput.addEventListener('input', requestUpdate);
elements.contrastCheck.addEventListener('change', () => performConversion());
elements.ditherCheck.addEventListener('change', () => performConversion());
elements.charsetSelect.addEventListener('change', handleCharsetChange);
elements.customCharsetInput.addEventListener('input', requestUpdate);
elements.colorSelect.addEventListener('change', updateDisplayMode);
elements.btnSaveTxt.addEventListener('click', saveTxt);
elements.btnSavePng.addEventListener('click', savePng);
elements.btnCopy.addEventListener('click', copyToClipboard);
if (elements.btnSaveZip) {
  elements.btnSaveZip.addEventListener('click', saveZip);
}
elements.asciiContainer.addEventListener('click', openPreviewFromCurrentOutput);
elements.previewCanvas.addEventListener('click', openPreviewFromCurrentOutput);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopGifLoop();
  } else if (isGif && currentImage) {
    startGifLoop();
  }
});

window.addEventListener('resize', () => {
  requestAnimationFrame(() => {
    if (elements.previewCanvas.style.display === 'block') {
      fitCanvasToScreen();
    } else {
      fitAsciiToScreen();
    }
  });
});
