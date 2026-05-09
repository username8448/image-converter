
(function initAppCoreRuntime() {
  type DosDateTime = {
    readonly dosDate: number;
    readonly dosTime: number;
  };
  type BrowserFileEntry = FileSystemEntry & {
    readonly isFile: true;
    file(successCallback: (file: File) => void, errorCallback?: () => void): void;
  };
  type BrowserDirectoryEntry = FileSystemEntry & {
    readonly isDirectory: true;
    createReader(): FileSystemDirectoryReader;
  };
  type QueueFallback = {
    readonly name?: string;
    readonly file?: {
      readonly name?: string;
    };
  };

  const AppCore = (window.AppCore = (window.AppCore || {}) as AppCoreRuntime);

  const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif)$/i;
  const TEXT_ENCODER = new TextEncoder();
  const CRC32_TABLE = buildCrc32Table();

  function getCanvasContext2d(canvas: HTMLCanvasElement, options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
    const context = canvas.getContext('2d', options);
    if (!context) {
      throw new Error('2D canvas context is unavailable.');
    }
    return context;
  }

  function isBrowserFileEntry(entry: FileSystemEntry): entry is BrowserFileEntry {
    return entry.isFile && typeof (entry as BrowserFileEntry).file === 'function';
  }

  function isBrowserDirectoryEntry(entry: FileSystemEntry): entry is BrowserDirectoryEntry {
    return entry.isDirectory && typeof (entry as BrowserDirectoryEntry).createReader === 'function';
  }

  function normalizePath(path: unknown): string {
    return String(path || '')
      .replaceAll('\\\\', '/')
      .replace(/^\.?\//, '')
      .replace(/\/+/g, '/')
      .trim();
  }

  function baseName(filename: unknown): string {
    const safeName = String(filename || '').trim();
    const lastDot = safeName.lastIndexOf('.');
    if (lastDot <= 0) return safeName || 'file';
    return safeName.slice(0, lastDot);
  }

  function getExtension(filename: unknown): string {
    const safeName = String(filename || '').trim();
    const dot = safeName.lastIndexOf('.');
    if (dot < 0 || dot === safeName.length - 1) return '';
    return safeName.slice(dot + 1).toLowerCase();
  }

  function sanitizeFileName(name: unknown): string {
    const cleaned = String(name || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'file';
  }

  function sanitizePath(path: unknown): string {
    const normalized = normalizePath(path);
    if (!normalized) return 'file.bin';
    const segments = normalized
      .split('/')
      .filter(Boolean)
      .map((segment) => sanitizeFileName(segment))
      .filter((segment) => segment !== '.' && segment !== '..');
    return segments.join('/') || 'file.bin';
  }

  function isImageFile(file: File | null | undefined): boolean {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    return IMAGE_EXT_RE.test(file.name || '');
  }

  function queueFileListToEntries(fileList: Iterable<File> | ArrayLike<File> | null | undefined): FileEntry[] {
    const entries: FileEntry[] = [];
    for (const file of Array.from(fileList || [])) {
      entries.push({
        file,
        relativePath: normalizePath(file.webkitRelativePath || file.name) || file.name,
      });
    }
    return entries;
  }

  function dedupeFileEntries(entries: readonly (FileEntry | null | undefined)[] | null | undefined): FileEntry[] {
    const map = new Map<string, FileEntry>();
    for (const entry of entries || []) {
      if (!entry || !entry.file) continue;
      const path = normalizePath(entry.relativePath || entry.file.webkitRelativePath || entry.file.name);
      const key = `${path}|${entry.file.size}|${entry.file.lastModified}`;
      if (!map.has(key)) {
        map.set(key, {
          file: entry.file,
          relativePath: path || entry.file.name,
        });
      }
    }
    return Array.from(map.values());
  }

  async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const entries: FileSystemEntry[] = [];
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (!batch.length) break;
      entries.push(...batch);
    }
    return entries;
  }

  async function readEntryRecursive(entry: FileSystemEntry | null, prefixPath: string): Promise<FileEntry[]> {
    if (!entry) return [];

    if (isBrowserFileEntry(entry)) {
      const file = await new Promise<File | null>((resolve) => {
        entry.file(resolve, () => resolve(null));
      });
      if (!file) return [];
      return [{ file, relativePath: `${prefixPath}${file.name}` }];
    }

    if (isBrowserDirectoryEntry(entry)) {
      const dirPrefix = `${prefixPath}${entry.name}/`;
      const reader = entry.createReader();
      const children = await readAllDirectoryEntries(reader);
      const nested = await Promise.all(children.map((child) => readEntryRecursive(child, dirPrefix)));
      return nested.flat();
    }

    return [];
  }

  async function extractDroppedFileEntries(dataTransfer: DataTransfer | null | undefined): Promise<FileEntry[]> {
    const direct: FileEntry[] = [];
    const entries: FileSystemEntry[] = [];

    if (dataTransfer && dataTransfer.items && dataTransfer.items.length) {
      for (const item of dataTransfer.items) {
        if (item.kind !== 'file') continue;

        if (typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entries.push(entry);
            continue;
          }
        }

        const file = item.getAsFile();
        if (file) {
          direct.push({ file, relativePath: file.name });
        }
      }
    }

    if (!entries.length && dataTransfer && dataTransfer.files && dataTransfer.files.length) {
      for (const file of dataTransfer.files) {
        direct.push({ file, relativePath: file.name });
      }
      return dedupeFileEntries(direct);
    }

    const nested = await Promise.all(entries.map((entry) => readEntryRecursive(entry, '')));
    return dedupeFileEntries([...direct, ...nested.flat()]);
  }

  function formatDateStamp(date: Date): string {
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}${m}${d}-${hh}${mm}${ss}`;
  }

  function triggerDownload(blob: Blob, fileNameToSave: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameToSave;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function toDosDateTime(date: Date): DosDateTime {
    const year = Math.max(1980, date.getFullYear());
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return { dosDate, dosTime };
  }

  function buildCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i] ?? 0;
      crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  function ensureUniqueEntryNames(entries: readonly ZipEntry[]): ZipEntry[] {
    const used = new Set<string>();
    return (entries || []).map((entry) => {
      let candidate = sanitizePath(entry.name);
      if (!used.has(candidate)) {
        used.add(candidate);
        return {
          ...entry,
          name: candidate,
        };
      }

      const lastSlash = candidate.lastIndexOf('/');
      const dir = lastSlash >= 0 ? candidate.slice(0, lastSlash + 1) : '';
      const file = lastSlash >= 0 ? candidate.slice(lastSlash + 1) : candidate;
      const dot = file.lastIndexOf('.');
      const base = dot > 0 ? file.slice(0, dot) : file;
      const ext = dot > 0 ? file.slice(dot) : '';

      let index = 2;
      while (true) {
        const nextName = `${dir}${base} (${index})${ext}`;
        if (!used.has(nextName)) {
          used.add(nextName);
          candidate = nextName;
          break;
        }
        index += 1;
      }

      return {
        ...entry,
        name: candidate,
      };
    });
  }

  function buildZipBlob(entries: readonly ZipEntry[]): Blob {
    const safeEntries = entries || [];
    const now = new Date();
    const { dosDate, dosTime } = toDosDateTime(now);
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const entry of safeEntries) {
      const nameBytes = TEXT_ENCODER.encode(entry.name);
      const data = new Uint8Array(entry.bytes);
      const crc = crc32(data);
      const compressedSize = data.length;
      const uncompressedSize = data.length;

      const localHeader = new Uint8Array(30 + nameBytes.length);
      writeU32LE(localHeader, 0, 0x04034b50);
      writeU16LE(localHeader, 4, 20);
      writeU16LE(localHeader, 6, 0x0800);
      writeU16LE(localHeader, 8, 0);
      writeU16LE(localHeader, 10, dosTime);
      writeU16LE(localHeader, 12, dosDate);
      writeU32LE(localHeader, 14, crc);
      writeU32LE(localHeader, 18, compressedSize);
      writeU32LE(localHeader, 22, uncompressedSize);
      writeU16LE(localHeader, 26, nameBytes.length);
      writeU16LE(localHeader, 28, 0);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      writeU32LE(centralHeader, 0, 0x02014b50);
      writeU16LE(centralHeader, 4, 20);
      writeU16LE(centralHeader, 6, 20);
      writeU16LE(centralHeader, 8, 0x0800);
      writeU16LE(centralHeader, 10, 0);
      writeU16LE(centralHeader, 12, dosTime);
      writeU16LE(centralHeader, 14, dosDate);
      writeU32LE(centralHeader, 16, crc);
      writeU32LE(centralHeader, 20, compressedSize);
      writeU32LE(centralHeader, 24, uncompressedSize);
      writeU16LE(centralHeader, 28, nameBytes.length);
      writeU16LE(centralHeader, 30, 0);
      writeU16LE(centralHeader, 32, 0);
      writeU16LE(centralHeader, 34, 0);
      writeU16LE(centralHeader, 36, 0);
      writeU32LE(centralHeader, 38, 0);
      writeU32LE(centralHeader, 42, offset);
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);
      offset += localHeader.length + data.length;
    }

    let centralSize = 0;
    for (const part of centralParts) {
      centralSize += part.length;
    }

    const endRecord = new Uint8Array(22);
    writeU32LE(endRecord, 0, 0x06054b50);
    writeU16LE(endRecord, 4, 0);
    writeU16LE(endRecord, 6, 0);
    writeU16LE(endRecord, 8, safeEntries.length);
    writeU16LE(endRecord, 10, safeEntries.length);
    writeU32LE(endRecord, 12, centralSize);
    writeU32LE(endRecord, 16, offset);
    writeU16LE(endRecord, 20, 0);

    return new Blob([...localParts, ...centralParts, endRecord].map(copyBytesToArrayBuffer), {
      type: 'application/zip',
    });
  }

  function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Не удалось сформировать PNG.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const tempUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(tempUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(tempUrl);
        reject(new Error(`Не удалось прочитать файл: ${file.name}`));
      };
      image.src = tempUrl;
    });
  }

  const files = {
    normalizePath,
    baseName,
    getExtension,
    sanitizeFileName,
    sanitizePath,
    isImageFile,
    queueFileListToEntries,
    dedupeFileEntries,
    extractDroppedFileEntries,
    loadImageFromFile,
  };

  const zip = {
    formatDateStamp,
    triggerDownload,
    ensureUniqueEntryNames,
    buildZipBlob,
    canvasToPngBlob,
  };

  AppCore.files = files;
  AppCore.zip = zip;

  window.SharedBatchTools = {
    normalizePath,
    baseName,
    getExtension,
    sanitizeFileName,
    sanitizePath,
    isImageFile,
    queueFileListToEntries,
    dedupeFileEntries,
    extractDroppedFileEntries,
    formatDateStamp,
    triggerDownload,
    ensureUniqueEntryNames,
    buildZipBlob,
  };

  function preventDefaults(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function initDragAndDrop(options: DragDropInitOptions): void {
    const { dropZone, fileInput, onFile, onFiles, ignoreSelector } = options || {};
    if (!dropZone || (typeof onFile !== 'function' && typeof onFiles !== 'function')) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      dropZone.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropZone.addEventListener(
        eventName,
        () => {
          dropZone.classList.add('drag-over');
        },
        false
      );
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropZone.addEventListener(
        eventName,
        () => {
          dropZone.classList.remove('drag-over');
        },
        false
      );
    });

    dropZone.addEventListener('drop', async (event) => {
      let entries: FileEntry[] = [];

      if (AppCore.files && typeof AppCore.files.extractDroppedFileEntries === 'function') {
        entries = await AppCore.files.extractDroppedFileEntries(event.dataTransfer);
      } else if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        entries = Array.from(event.dataTransfer.files).map((file) => ({ file, relativePath: file.name }));
      }

      if (typeof onFiles === 'function' && entries.length) {
        onFiles(entries, event);
        return;
      }

      const firstFile = entries[0]?.file ?? null;
      if (firstFile && typeof onFile === 'function') {
        onFile(firstFile, event);
      }
    });

    dropZone.addEventListener('click', (event) => {
      if (ignoreSelector && event.target instanceof Element && event.target.closest(ignoreSelector)) return;
      if (!fileInput) return;
      fileInput.click();
    });
  }

  AppCore.dragDrop = { init: initDragAndDrop };
  window.SharedDragDrop = AppCore.dragDrop;

  function escapeHtml(text: unknown): string {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toEntries(fileList: Iterable<File> | ArrayLike<File> | null | undefined): FileEntry[] {
    const filesList = Array.from(fileList || []);
    if (!filesList.length) return [];

    if (AppCore.files && typeof AppCore.files.queueFileListToEntries === 'function') {
      return AppCore.files.queueFileListToEntries(filesList);
    }

    return filesList.map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
  }

  function bindIngestControls(options: BindIngestControlsOptions): void {
    const {
      fileInput,
      folderInput,
      dropZone,
      pickFilesBtn,
      pickFolderBtn,
      clearQueueBtn,
      ignoreSelector,
      onEntries,
      onFile,
      onClear,
      isBusy,
    } = options || {};

    const busyCheck = typeof isBusy === 'function' ? isBusy : () => false;

    function handleEntriesFromFileList(fileList: Iterable<File> | ArrayLike<File> | null | undefined, sourceLabel: string, event: Event): void {
      const entries = toEntries(fileList);
      if (!entries.length) return;

      if (typeof onEntries === 'function') {
        onEntries(entries, sourceLabel, event);
        return;
      }

      if (typeof onFile === 'function') {
        const firstEntry = entries[0];
        if (firstEntry) {
          onFile(firstEntry.file, event);
        }
      }
    }

    if (pickFilesBtn && fileInput) {
      pickFilesBtn.addEventListener('click', () => {
        if (busyCheck()) return;
        fileInput.click();
      });
    }

    if (pickFolderBtn && folderInput) {
      pickFolderBtn.addEventListener('click', () => {
        if (busyCheck()) return;
        folderInput.click();
      });
    }

    if (clearQueueBtn && typeof onClear === 'function') {
      clearQueueBtn.addEventListener('click', () => {
        if (busyCheck()) return;
        onClear();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (event) => {
        const input = event.currentTarget;
        if (!(input instanceof HTMLInputElement)) return;
        if (busyCheck()) {
          input.value = '';
          return;
        }
        handleEntriesFromFileList(input.files, 'выбора файлов', event);
        input.value = '';
      });
    }

    if (folderInput) {
      folderInput.addEventListener('change', (event) => {
        const input = event.currentTarget;
        if (!(input instanceof HTMLInputElement)) return;
        if (busyCheck()) {
          input.value = '';
          return;
        }
        handleEntriesFromFileList(input.files, 'выбора папки', event);
        input.value = '';
      });
    }

    if (dropZone && AppCore.dragDrop && typeof AppCore.dragDrop.init === 'function') {
      AppCore.dragDrop.init({
        dropZone,
        fileInput: fileInput ?? null,
        ...(ignoreSelector ? { ignoreSelector } : {}),
        onFile: (file, event) => {
          if (busyCheck()) return;
          if (typeof onFile === 'function') {
            onFile(file, event);
          }
        },
        onFiles: (entries, event) => {
          if (busyCheck()) return;
          if (typeof onEntries === 'function') {
            onEntries(entries, 'drag&drop', event);
            return;
          }
          if (typeof onFile === 'function' && entries && entries[0] && entries[0].file) {
            onFile(entries[0].file, event);
          }
        },
      });
    }
  }

  function bindQueueList(options: BindQueueListOptions): void {
    const {
      queueList,
      onSelect,
      onRemove,
      isBusy,
      selectAttr = 'data-select-key',
      removeAttr = 'data-remove-key',
      decodeSelect = decodeURIComponent,
      decodeRemove = decodeURIComponent,
    } = options || {};

    if (!queueList) return;
    const busyCheck = typeof isBusy === 'function' ? isBusy : () => false;

    queueList.addEventListener('click', (event) => {
      if (busyCheck()) return;

      if (removeAttr && typeof onRemove === 'function' && event.target instanceof Element) {
        const removeTarget = event.target.closest(`[${removeAttr}]`);
        if (removeTarget) {
          const raw = removeTarget.getAttribute(removeAttr);
          if (!raw) return;
          try {
            onRemove(decodeRemove(raw), event);
          } catch (_err) {
            onRemove(raw, event);
          }
          return;
        }
      }

      if (selectAttr && typeof onSelect === 'function' && event.target instanceof Element) {
        const selectTarget = event.target.closest(`[${selectAttr}]`);
        if (!selectTarget) return;
        const raw = selectTarget.getAttribute(selectAttr);
        if (!raw) return;
        try {
          onSelect(decodeSelect(raw), event);
        } catch (_err) {
          onSelect(raw, event);
        }
      }
    });
  }

  function renderQueue<T>(options: RenderQueueOptions<T>): void {
    const {
      queueList,
      items,
      emptyText = 'Добавьте файлы для обработки',
      isBusy = false,
      isActive,
      getItemId,
      getName,
      getPath,
      getBadgeClass,
      getBadgeText,
      showRemove = true,
      removeDisabled,
      selectAttr = 'data-select-key',
      removeAttr = 'data-remove-key',
      encodeId = encodeURIComponent,
    } = options || {};

    if (!queueList) return;

    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      queueList.innerHTML = `<div class="queue-empty">${escapeHtml(emptyText)}</div>`;
      return;
    }

    const rows = list.map((item, index) => {
      const idRaw = typeof getItemId === 'function' ? getItemId(item, index) : index;
      const id = encodeId(String(idRaw));
      const active = typeof isActive === 'function' ? Boolean(isActive(item, index)) : false;
      const fallback = item as QueueFallback;
      const name = typeof getName === 'function' ? getName(item, index) : fallback.name || fallback.file?.name || 'file';
      const path = typeof getPath === 'function' ? getPath(item, index) : '';
      const badgeClass = typeof getBadgeClass === 'function' ? getBadgeClass(item, index) : '';
      const badgeText = typeof getBadgeText === 'function' ? getBadgeText(item, index) : '';
      const disableRemove =
        typeof removeDisabled === 'function'
          ? Boolean(removeDisabled(item, index))
          : Boolean(removeDisabled || isBusy);
      const removeDisabledAttr = disableRemove ? 'disabled' : '';

      const relative = path ? `<span class="queue-path">${escapeHtml(path)}</span>` : '';
      const activeClass = active ? ' active' : '';

      return `
        <div class="queue-item${activeClass}" ${selectAttr}="${id}">
          <div class="queue-name">${escapeHtml(name)}${relative}</div>
          <span class="queue-badge ${escapeHtml(badgeClass)}">${escapeHtml(badgeText)}</span>
          ${showRemove ? `<button type="button" class="queue-remove" ${removeAttr}="${id}" ${removeDisabledAttr}>×</button>` : ''}
        </div>
      `;
    });

    queueList.innerHTML = rows.join('');
  }

  function updateIngestButtons(options: UpdateIngestButtonsOptions): void {
    const {
      pickFilesBtn,
      pickFolderBtn,
      clearQueueBtn,
      fileInput,
      folderInput,
      zipBtn,
      busy,
      queueLength,
      disableZipWhenQueueEmpty = true,
    } = options || {};

    const disabled = Boolean(busy);
    const hasQueue = Number(queueLength) > 0;

    if (pickFilesBtn) pickFilesBtn.disabled = disabled;
    if (pickFolderBtn) pickFolderBtn.disabled = disabled;
    if (clearQueueBtn) clearQueueBtn.disabled = disabled || !hasQueue;
    if (fileInput) fileInput.disabled = disabled;
    if (folderInput) folderInput.disabled = disabled;
    if (zipBtn) {
      zipBtn.disabled = disabled || (disableZipWhenQueueEmpty && !hasQueue);
    }
  }

  function setZipButtonProgress(zipBtn: HTMLButtonElement | null | undefined, current: number, total: number): void {
    if (!zipBtn) return;
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
    zipBtn.textContent = `ZIP ${current}/${total}`;
  }

  function resetZipButtonLabel(zipBtn: HTMLButtonElement | null | undefined, label?: string): void {
    if (!zipBtn) return;
    zipBtn.textContent = label || 'Скачать все (.zip)';
  }

  AppCore.ingestUi = {
    escapeHtml,
    bindIngestControls,
    bindQueueList,
    renderQueue,
    updateIngestButtons,
    setZipButtonProgress,
    resetZipButtonLabel,
  };

  window.SharedIngestQueueUi = AppCore.ingestUi;

  function showPreview(options: PreviewOptions): void {
    const { previewImg, originalPreview, placeholder, src, onload } = options || {};
    if (!previewImg || !originalPreview || !placeholder || !src) return;

    previewImg.onload = () => {
      if (typeof onload === 'function') {
        onload();
      }
    };

    previewImg.src = src;
    originalPreview.style.display = 'block';
    placeholder.style.display = 'none';
  }

  function clearPreview(options: PreviewOptions): void {
    const { previewImg, originalPreview, placeholder } = options || {};
    if (!previewImg || !originalPreview || !placeholder) return;

    previewImg.src = '';
    originalPreview.style.display = 'none';
    placeholder.style.display = 'flex';
  }

  AppCore.preview = {
    show: showPreview,
    clear: clearPreview,
  };

  window.SharedOriginalPreview = AppCore.preview;

  let gifuctPromise: Promise<GifuctExports> | null = null;
  const fileBufferCache = new WeakMap<File, Promise<ArrayBuffer>>();
  const NON_GIF_IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|svg|avif|heic|heif|ico)$/i;

  function getFileBuffer(file: File | null | undefined): Promise<ArrayBuffer | null> {
    if (!file) return Promise.resolve(null);
    const cached = fileBufferCache.get(file);
    if (cached) return cached;

    const promise = file.arrayBuffer().catch((err: unknown) => {
      fileBufferCache.delete(file);
      throw err;
    });
    fileBufferCache.set(file, promise);
    return promise;
  }

  function resolveGifuctExports(): GifuctExports | null {
    if (window.gifuct && typeof window.gifuct.parseGIF === 'function' && typeof window.gifuct.decompressFrames === 'function') {
      return {
        parseGIF: window.gifuct.parseGIF,
        decompressFrames: window.gifuct.decompressFrames,
      };
    }
    if (typeof window.parseGIF === 'function' && typeof window.decompressFrames === 'function') {
      return {
        parseGIF: window.parseGIF,
        decompressFrames: window.decompressFrames,
      };
    }
    return null;
  }

  function loadGifuct(gifuctUrl: string): Promise<GifuctExports> {
    const existing = resolveGifuctExports();
    if (existing) return Promise.resolve(existing);
    if (gifuctPromise) return gifuctPromise;

    gifuctPromise = (async () => {
      try {
        const mod = await import(gifuctUrl) as Partial<GifuctExports> & { default?: Partial<GifuctExports> };
        const parseGIF = mod.parseGIF || mod.default?.parseGIF;
        const decompressFrames = mod.decompressFrames || mod.default?.decompressFrames;
        if (parseGIF && decompressFrames) {
          return { parseGIF, decompressFrames };
        }
      } catch (_err) {
      }

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = gifuctUrl;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('gifuct.js не загрузился (offline).'));
        document.head.appendChild(script);
      });

      const globals = resolveGifuctExports();
      if (!globals) {
        throw new Error('gifuct.js не загрузился (offline).');
      }
      return globals;
    })();

    return gifuctPromise;
  }

  async function decodeGifWithImageDecoder(
    buffer: ArrayBuffer,
    token: number,
    options?: GifDecodeOptions,
  ): Promise<GifFrame[] | null> {
    if (typeof ImageDecoder === 'undefined') return null;
    const isTokenValid = options && typeof options.isTokenValid === 'function' ? options.isTokenValid : () => true;
    const frameInterval = options && options.frameInterval ? options.frameInterval : 1000 / 24;

    if (!buffer || !isTokenValid(token)) return null;

    const decoder = new ImageDecoder({ data: buffer, type: 'image/gif' });
    await decoder.tracks.ready;

    if (!isTokenValid(token)) {
      if (typeof decoder.close === 'function') decoder.close();
      return null;
    }

    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount <= 1) {
      if (typeof decoder.close === 'function') decoder.close();
      return null;
    }

    const frames: GifFrame[] = [];
    for (let i = 0; i < track.frameCount; i++) {
      if (!isTokenValid(token)) break;
      const result = await decoder.decode({ frameIndex: i });
      const frame = result.image;
      const frameWidth = frame.displayWidth || frame.codedWidth;
      const frameHeight = frame.displayHeight || frame.codedHeight;
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = frameWidth;
      frameCanvas.height = frameHeight;
      const frameCtx = getCanvasContext2d(frameCanvas);
      frameCtx.drawImage(frame, 0, 0);
      const durationMs = frame.duration ? frame.duration / 1000 : frameInterval;
      if (frame && typeof frame.close === 'function') frame.close();
      frames.push({ canvas: frameCanvas, delay: Math.max(durationMs || frameInterval, frameInterval) });
    }

    if (typeof decoder.close === 'function') decoder.close();
    if (!isTokenValid(token)) return null;
    return frames.length ? frames : null;
  }

  function buildGifuctFrames(
    frames: readonly GifuctFrame[],
    width: number,
    height: number,
    frameInterval: number,
  ): GifFrame[] | null {
    if (!frames || frames.length === 0) return null;

    const masterCanvas = document.createElement('canvas');
    masterCanvas.width = width;
    masterCanvas.height = height;
    const masterCtx = getCanvasContext2d(masterCanvas);
    const output: GifFrame[] = [];

    frames.forEach((frame) => {
      let saved: ImageData | null = null;
      if (frame.disposalType === 3) {
        saved = masterCtx.getImageData(0, 0, width, height);
      }

      if (frame.patch) {
        const patch = new Uint8ClampedArray(frame.patch);
        const imageData = new ImageData(patch, frame.dims.width, frame.dims.height);
        masterCtx.putImageData(imageData, frame.dims.left, frame.dims.top);
      }

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      getCanvasContext2d(frameCanvas).drawImage(masterCanvas, 0, 0);

      const delay = frame.delay ? Math.max(frame.delay, frameInterval) : frameInterval;
      output.push({ canvas: frameCanvas, delay });

      if (frame.disposalType === 2) {
        masterCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
      } else if (frame.disposalType === 3 && saved) {
        masterCtx.putImageData(saved, 0, 0);
      }
    });

    return output;
  }

  async function decodeGifWithGifuct(
    buffer: ArrayBuffer,
    token: number,
    options?: GifDecodeOptions,
  ): Promise<GifFrame[] | null> {
    const isTokenValid = options && typeof options.isTokenValid === 'function' ? options.isTokenValid : () => true;
    const frameInterval = options && options.frameInterval ? options.frameInterval : 1000 / 24;
    const gifuctUrl = options && options.gifuctUrl ? options.gifuctUrl : '../shared/vendor/gifuct.js';

    try {
      if (!buffer || !isTokenValid(token)) return null;
      const { parseGIF, decompressFrames } = await loadGifuct(gifuctUrl);
      if (!parseGIF || !decompressFrames || !isTokenValid(token)) return null;

      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      const firstFrame = frames[0];
      if (!firstFrame) return null;
      const width = gif.lsd ? gif.lsd.width : firstFrame.dims.width;
      const height = gif.lsd ? gif.lsd.height : firstFrame.dims.height;
      return buildGifuctFrames(frames, width, height, frameInterval);
    } catch (err) {
      console.warn(err);
      return null;
    }
  }

  async function loadGifFrames(file: File, token: number, options?: GifDecodeOptions): Promise<GifFrame[] | null> {
    const isTokenValid = options && typeof options.isTokenValid === 'function' ? options.isTokenValid : () => true;

    const buffer = await getFileBuffer(file);
    if (!buffer || !isTokenValid(token)) return null;

    let frames = await decodeGifWithImageDecoder(buffer, token, options);
    if (!frames) {
      frames = await decodeGifWithGifuct(buffer, token, options);
    }
    if (!isTokenValid(token)) return null;
    return frames && frames.length ? frames : null;
  }

  async function isGifFile(file: File | null | undefined): Promise<boolean> {
    if (!file) return false;

    const type = (file.type || '').toLowerCase();
    if (type === 'image/gif') return true;
    if (type.startsWith('image/')) return false;

    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.gif')) return true;
    if (NON_GIF_IMAGE_EXT_RE.test(name)) return false;

    const header = await file.slice(0, 6).arrayBuffer();
    const sig = String.fromCharCode(...new Uint8Array(header));
    return sig === 'GIF87a' || sig === 'GIF89a';
  }

  AppCore.gifDecode = {
    isGifFile,
    loadGifFrames,
  };

  window.SharedGifDecode = AppCore.gifDecode;

  let gifJsPromise: Promise<GifJsConstructor> | null = null;
  let gifWorkerBlobUrl: string | null = null;

  function resolveWorkerScriptUrl(workerUrl: string): string {
    if (location.protocol !== 'file:') return workerUrl;
    if (!gifWorkerBlobUrl && window.GifWorkerInlineSource) {
      try {
        const blob = new Blob([window.GifWorkerInlineSource], { type: 'application/javascript' });
        gifWorkerBlobUrl = URL.createObjectURL(blob);
      } catch (_err) {
        return workerUrl;
      }
    }
    return gifWorkerBlobUrl || workerUrl;
  }

  function loadGifJs(gifJsUrl: string): Promise<GifJsConstructor> {
    if (typeof window.GIF !== 'undefined') {
      return Promise.resolve(window.GIF);
    }
    if (gifJsPromise) return gifJsPromise;

    gifJsPromise = new Promise<GifJsConstructor>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = gifJsUrl;
      script.async = true;
      script.onload = () => {
        if (typeof window.GIF === 'undefined') {
          reject(new Error(`GIF.js не загрузился. Добавьте ${gifJsUrl}`));
          return;
        }
        resolve(window.GIF);
      };
      script.onerror = () => reject(new Error('Не удалось загрузить GIF.js (offline).'));
      document.head.appendChild(script);
    });

    return gifJsPromise;
  }

  AppCore.gifEncode = {
    resolveWorkerScriptUrl,
    loadGifJs,
  };

  window.SharedGifEncode = AppCore.gifEncode;

  if (typeof window.PreviewModal === 'undefined') {
    class PreviewModal {
      private modal: HTMLElement;
      private canvas: HTMLCanvasElement;
      private ctx: CanvasRenderingContext2D;
      private closeBtn: HTMLElement;
      private zoomLevel: HTMLElement;
      isOpen: boolean;
      private scale: number;
      private minScale: number;
      private maxScale: number;
      private offsetX: number;
      private offsetY: number;
      private isDragging: boolean;
      private hasDragged: boolean;
      private dragStartX: number;
      private dragStartY: number;
      private lastX: number;
      private lastY: number;
      private imageWidth: number;
      private imageHeight: number;
      private containerWidth: number;
      private containerHeight: number;

      constructor() {
        const modal = document.getElementById('preview-modal');
        const canvas = document.getElementById('preview-modal-canvas');
        const closeBtn = document.getElementById('preview-close');
        const zoomLevel = document.getElementById('zoom-level');

        if (!(modal instanceof HTMLElement)) throw new Error('Preview modal element is missing.');
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Preview modal canvas is missing.');
        if (!(closeBtn instanceof HTMLElement)) throw new Error('Preview close button is missing.');
        if (!(zoomLevel instanceof HTMLElement)) throw new Error('Preview zoom label is missing.');

        this.modal = modal;
        this.canvas = canvas;
        this.ctx = getCanvasContext2d(canvas);
        this.closeBtn = closeBtn;
        this.zoomLevel = zoomLevel;

        this.isOpen = false;
        this.scale = 1.0;
        this.minScale = 0.1;
        this.maxScale = 10.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
        this.hasDragged = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.lastX = 0;
        this.lastY = 0;
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.containerWidth = 0;
        this.containerHeight = 0;

        this.initEventListeners();
      }

      initEventListeners(): void {
        this.closeBtn.addEventListener('click', () => this.close());

        this.modal.addEventListener('click', (e) => {
          if (e.target === this.modal) {
            this.close();
          }
        });

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && this.isOpen) {
            this.close();
          }
        });

        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
      }

      open(previewCanvas: HTMLCanvasElement): void {
        if (!previewCanvas) {
          alert('Нет данных для предпросмотра!');
          return;
        }

        this.imageWidth = previewCanvas.width;
        this.imageHeight = previewCanvas.height;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        this.containerWidth = viewportWidth;
        this.containerHeight = viewportHeight;

        const targetWidth = viewportWidth * 0.6;
        const targetHeight = viewportHeight * 0.6;
        const scaleX = targetWidth / this.imageWidth;
        const scaleY = targetHeight / this.imageHeight;
        this.scale = Math.min(scaleX, scaleY);

        this.offsetX = (viewportWidth - this.imageWidth * this.scale) / 2;
        this.offsetY = (viewportHeight - this.imageHeight * this.scale) / 2;

        this.canvas.width = this.imageWidth;
        this.canvas.height = this.imageHeight;
        this.ctx.clearRect(0, 0, this.imageWidth, this.imageHeight);
        this.ctx.drawImage(previewCanvas, 0, 0);

        this.modal.style.display = 'flex';
        this.isOpen = true;

        this.render();
      }

      update(previewCanvas: HTMLCanvasElement): void {
        if (!this.isOpen || !previewCanvas) return;

        if (previewCanvas.width !== this.imageWidth || previewCanvas.height !== this.imageHeight) {
          this.open(previewCanvas);
          return;
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(previewCanvas, 0, 0);
      }

      close(): void {
        this.modal.style.display = 'none';
        this.isOpen = false;
        this.isDragging = false;
        this.hasDragged = false;
      }

      zoomAt(mouseX: number, mouseY: number, factor: number): void {
        const newScale = this.scale * factor;
        if (newScale < this.minScale || newScale > this.maxScale) return;

        const canvasX = (mouseX - this.offsetX) / this.scale;
        const canvasY = (mouseY - this.offsetY) / this.scale;

        this.scale = newScale;
        this.offsetX = mouseX - canvasX * this.scale;
        this.offsetY = mouseY - canvasY * this.scale;

        this.constrainOffset();
        this.render();
      }

      handleWheel(e: WheelEvent): void {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoomAt(e.clientX, e.clientY, delta);
      }

      handleMouseDown(e: MouseEvent): void {
        if (e.button !== 0) return;
        this.isDragging = true;
        this.hasDragged = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
      }

      handleMouseMove(e: MouseEvent): void {
        if (!this.isDragging) return;
        const deltaX = e.clientX - this.lastX;
        const deltaY = e.clientY - this.lastY;
        const totalDx = e.clientX - this.dragStartX;
        const totalDy = e.clientY - this.dragStartY;

        if (!this.hasDragged && (Math.abs(totalDx) > 3 || Math.abs(totalDy) > 3)) {
          this.hasDragged = true;
        }

        if (this.hasDragged) {
          this.offsetX += deltaX;
          this.offsetY += deltaY;
          this.constrainOffset();
          this.render();
        }

        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }

      handleMouseUp(e: MouseEvent): void {
        if (!this.isDragging) return;
        if (!this.hasDragged) {
          this.zoomAt(e.clientX, e.clientY, 1.5);
        }
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
      }

      constrainOffset(): void {
        const scaledWidth = this.imageWidth * this.scale;
        const scaledHeight = this.imageHeight * this.scale;

        const minOffsetX = this.containerWidth - scaledWidth;
        const maxOffsetX = 0;
        const minOffsetY = this.containerHeight - scaledHeight;
        const maxOffsetY = 0;

        if (scaledWidth < this.containerWidth) {
          this.offsetX = (this.containerWidth - scaledWidth) / 2;
        } else {
          this.offsetX = Math.max(minOffsetX, Math.min(maxOffsetX, this.offsetX));
        }

        if (scaledHeight < this.containerHeight) {
          this.offsetY = (this.containerHeight - scaledHeight) / 2;
        } else {
          this.offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, this.offsetY));
        }
      }

      render(): void {
        if (!this.isOpen) return;

        const scaledWidth = this.imageWidth * this.scale;
        const scaledHeight = this.imageHeight * this.scale;

        this.canvas.style.width = `${scaledWidth}px`;
        this.canvas.style.height = `${scaledHeight}px`;
        this.canvas.style.left = `${this.offsetX}px`;
        this.canvas.style.top = `${this.offsetY}px`;

        this.zoomLevel.textContent = `${Math.round(this.scale * 100)}%`;
      }
    }

    window.PreviewModal = PreviewModal;
  }

  let settingsInitialized = false;

  function initSettingsPanelToggle() {
    if (settingsInitialized) return;

    const body = document.body;
    const panel = document.querySelector<HTMLElement>('.settings-panel');
    const toggle = document.querySelector<HTMLElement>('[data-settings-toggle]');
    const mobileQuery = window.matchMedia('(max-width: 768px)');

    if (!body || !panel || !toggle) {
      return;
    }

    const settingsPanel = panel;
    const settingsToggle = toggle;
    settingsInitialized = true;

    const OPEN_CLASS = 'settings-open';

    function isMobileMode(): boolean {
      return mobileQuery.matches;
    }

    function isOpen(): boolean {
      return body.classList.contains(OPEN_CLASS);
    }

    function updateTogglePosition(): void {
      if (!isMobileMode() || !isOpen()) {
        settingsToggle.style.left = '8px';
        return;
      }

      const panelRect = settingsPanel.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - 24, Math.round(panelRect.right + 4)));
      settingsToggle.style.left = `${left}px`;
    }

    function syncUi(open: boolean): void {
      const shouldOpen = isMobileMode() && open;
      body.classList.toggle(OPEN_CLASS, shouldOpen);
      settingsToggle.textContent = shouldOpen ? '<' : '>';
      settingsToggle.setAttribute('aria-expanded', String(shouldOpen));
      settingsToggle.setAttribute('aria-label', shouldOpen ? 'Закрыть панель настроек' : 'Открыть панель настроек');

      if (isMobileMode()) {
        settingsPanel.setAttribute('aria-hidden', String(!shouldOpen));
        settingsPanel.inert = !shouldOpen;
      } else {
        settingsPanel.removeAttribute('aria-hidden');
        settingsPanel.inert = false;
      }

      updateTogglePosition();
    }

    function applyMode(): void {
      if (isMobileMode()) {
        syncUi(false);
        return;
      }

      body.classList.remove(OPEN_CLASS);
      settingsToggle.style.left = '';
      settingsToggle.textContent = '>';
      settingsToggle.setAttribute('aria-expanded', 'false');
      settingsToggle.setAttribute('aria-label', 'Открыть панель настроек');
      settingsPanel.removeAttribute('aria-hidden');
      settingsPanel.inert = false;
    }

    settingsToggle.addEventListener('click', () => {
      if (!isMobileMode()) {
        return;
      }
      syncUi(!isOpen());
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isMobileMode() && isOpen()) {
        syncUi(false);
      }
    });

    window.addEventListener('resize', updateTogglePosition);
    window.addEventListener('orientationchange', updateTogglePosition);

    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', applyMode);
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(applyMode);
    }

    applyMode();
  }

  AppCore.settings = {
    init: initSettingsPanelToggle,
  };

  initSettingsPanelToggle();
})();

export {};
