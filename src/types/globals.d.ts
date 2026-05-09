interface HTMLInputElement {
  webkitdirectory: boolean;
  directory: boolean;
}

interface GifFrame {
  readonly canvas: HTMLCanvasElement;
  readonly delay: number;
}

interface GifDecodeOptions {
  readonly gifuctUrl?: string;
  readonly frameInterval?: number;
  readonly isTokenValid?: (token: number) => boolean;
}

interface GifJsOptions {
  readonly workers: number;
  readonly quality: number;
  readonly workerScript: string;
  readonly width?: number;
  readonly height?: number;
  readonly background?: string;
  readonly repeat: number;
}

interface GifJsFrameOptions {
  readonly delay: number;
  readonly copy?: boolean;
}

interface GifJsEncoder {
  addFrame(canvas: HTMLCanvasElement, options: GifJsFrameOptions): void;
  on(event: "progress", callback: (progress: number) => void): void;
  on(event: "finished", callback: (blob: Blob) => void): void;
  render(): void;
}

interface GifJsConstructor {
  new (options: GifJsOptions): GifJsEncoder;
}

interface GifuctDims {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface GifuctFrame {
  readonly patch?: Uint8ClampedArray;
  readonly dims: GifuctDims;
  readonly delay?: number;
  readonly disposalType?: number;
}

interface GifuctImage {
  readonly lsd?: {
    readonly width: number;
    readonly height: number;
  };
}

interface GifuctExports {
  parseGIF(buffer: ArrayBuffer): GifuctImage;
  decompressFrames(gif: GifuctImage, buildPatch: boolean): GifuctFrame[];
}

interface FileEntry {
  readonly file: File;
  readonly relativePath: string;
}

interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

interface AppCoreFiles {
  normalizePath(path: unknown): string;
  baseName(filename: unknown): string;
  getExtension(filename: unknown): string;
  sanitizeFileName(name: unknown): string;
  sanitizePath(path: unknown): string;
  isImageFile(file: File | null | undefined): boolean;
  queueFileListToEntries(fileList: Iterable<File> | ArrayLike<File> | null | undefined): FileEntry[];
  dedupeFileEntries(entries: readonly (FileEntry | null | undefined)[] | null | undefined): FileEntry[];
  extractDroppedFileEntries(dataTransfer: DataTransfer | null | undefined): Promise<FileEntry[]>;
  loadImageFromFile(file: File): Promise<HTMLImageElement>;
}

interface AppCoreZip {
  formatDateStamp(date: Date): string;
  triggerDownload(blob: Blob, fileNameToSave: string): void;
  ensureUniqueEntryNames(entries: readonly ZipEntry[]): ZipEntry[];
  buildZipBlob(entries: readonly ZipEntry[]): Blob;
  canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob>;
}

interface DragDropInitOptions {
  readonly dropZone?: HTMLElement | null;
  readonly fileInput?: HTMLInputElement | null;
  readonly onFile?: (file: File, event: DragEvent | Event) => void;
  readonly onFiles?: (entries: FileEntry[], event: DragEvent | Event) => void;
  readonly ignoreSelector?: string;
}

interface AppCoreDragDrop {
  init(options: DragDropInitOptions): void;
}

interface BindIngestControlsOptions {
  readonly fileInput?: HTMLInputElement | null;
  readonly folderInput?: HTMLInputElement | null;
  readonly dropZone?: HTMLElement | null;
  readonly pickFilesBtn?: HTMLButtonElement | null;
  readonly pickFolderBtn?: HTMLButtonElement | null;
  readonly clearQueueBtn?: HTMLButtonElement | null;
  readonly ignoreSelector?: string;
  readonly onEntries?: (entries: FileEntry[], sourceLabel: string, event: Event) => void;
  readonly onFile?: (file: File, event: Event) => void;
  readonly onClear?: () => void;
  readonly isBusy?: () => boolean;
}

interface BindQueueListOptions {
  readonly queueList?: HTMLElement | null;
  readonly onSelect?: (key: string, event: MouseEvent) => void;
  readonly onRemove?: (key: string, event: MouseEvent) => void;
  readonly isBusy?: () => boolean;
  readonly selectAttr?: string;
  readonly removeAttr?: string;
  readonly decodeSelect?: (value: string) => string;
  readonly decodeRemove?: (value: string) => string;
}

interface RenderQueueOptions<T> {
  readonly queueList?: HTMLElement | null;
  readonly items?: readonly T[];
  readonly emptyText?: string;
  readonly isBusy?: boolean;
  readonly isActive?: (item: T, index: number) => boolean;
  readonly getItemId?: (item: T, index: number) => string | number;
  readonly getName?: (item: T, index: number) => string;
  readonly getPath?: (item: T, index: number) => string;
  readonly getBadgeClass?: (item: T, index: number) => string;
  readonly getBadgeText?: (item: T, index: number) => string;
  readonly showRemove?: boolean;
  readonly removeDisabled?: boolean | ((item: T, index: number) => boolean);
  readonly selectAttr?: string;
  readonly removeAttr?: string;
  readonly encodeId?: (value: string) => string;
}

interface UpdateIngestButtonsOptions {
  readonly pickFilesBtn?: HTMLButtonElement | null;
  readonly pickFolderBtn?: HTMLButtonElement | null;
  readonly clearQueueBtn?: HTMLButtonElement | null;
  readonly fileInput?: HTMLInputElement | null;
  readonly folderInput?: HTMLInputElement | null;
  readonly zipBtn?: HTMLButtonElement | null;
  readonly busy?: boolean;
  readonly queueLength?: number;
  readonly disableZipWhenQueueEmpty?: boolean;
}

interface AppCoreIngestUi {
  escapeHtml(text: unknown): string;
  bindIngestControls(options: BindIngestControlsOptions): void;
  bindQueueList(options: BindQueueListOptions): void;
  renderQueue<T>(options: RenderQueueOptions<T>): void;
  updateIngestButtons(options: UpdateIngestButtonsOptions): void;
  setZipButtonProgress(zipBtn: HTMLButtonElement | null | undefined, current: number, total: number): void;
  resetZipButtonLabel(zipBtn: HTMLButtonElement | null | undefined, label?: string): void;
}

interface PreviewOptions {
  readonly previewImg?: HTMLImageElement | null;
  readonly originalPreview?: HTMLElement | null;
  readonly placeholder?: HTMLElement | null;
  readonly src?: string;
  readonly onload?: () => void;
}

interface AppCorePreview {
  show(options: PreviewOptions): void;
  clear(options: PreviewOptions): void;
}

interface AppCoreGifDecode {
  isGifFile(file: File | null | undefined): Promise<boolean>;
  loadGifFrames(file: File, token: number, options?: GifDecodeOptions): Promise<GifFrame[] | null>;
}

interface AppCoreGifEncode {
  resolveWorkerScriptUrl(workerUrl: string): string;
  loadGifJs(gifJsUrl: string): Promise<GifJsConstructor>;
}

interface AppCoreSettings {
  init(): void;
}

interface AppCoreRuntime {
  files: AppCoreFiles;
  zip: AppCoreZip;
  dragDrop: AppCoreDragDrop;
  ingestUi: AppCoreIngestUi;
  preview: AppCorePreview;
  gifDecode: AppCoreGifDecode;
  gifEncode: AppCoreGifEncode;
  settings: AppCoreSettings;
}

interface PreviewModal {
  readonly isOpen: boolean;
  open(sourceCanvas: HTMLCanvasElement): void;
  update(sourceCanvas: HTMLCanvasElement): void;
  close(): void;
}

interface PreviewModalConstructor {
  new (): PreviewModal;
}

interface AppI18nRuntime {
  readonly lang: "en" | "ru";
  readonly isEnglish: boolean;
  t(input: unknown, params?: Record<string, unknown>): string;
  translateText(text: unknown): string;
  apply(root: ParentNode): void;
}

interface Window {
  AppCore: AppCoreRuntime;
  SharedBatchTools: Partial<AppCoreFiles & AppCoreZip>;
  SharedDragDrop: AppCoreDragDrop;
  SharedIngestQueueUi: AppCoreIngestUi;
  SharedOriginalPreview: AppCorePreview;
  SharedGifDecode: AppCoreGifDecode;
  SharedGifEncode: AppCoreGifEncode;
  PreviewModal: PreviewModalConstructor;
  AppI18n: AppI18nRuntime;
  GifWorkerInlineSource?: string;
  GIF?: GifJsConstructor;
  gifuct?: GifuctExports;
  parseGIF?: GifuctExports["parseGIF"];
  decompressFrames?: GifuctExports["decompressFrames"];
}

declare const PreviewModal: PreviewModalConstructor;
