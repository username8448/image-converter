(function initAppI18n() {
  const LANG_EN = 'en';
  const LANG_RU = 'ru';
  type Language = typeof LANG_EN | typeof LANG_RU;
  type DynamicReplacer = {
    readonly re: RegExp;
    readonly fn: (match: string, ...captures: string[]) => string;
  };

  function detectLanguage(): Language {
    const candidates: string[] = [];
    if (Array.isArray(navigator.languages)) {
      candidates.push(...navigator.languages);
    }
    if (navigator.language) {
      candidates.push(navigator.language);
    }
    for (const value of candidates) {
      if (/^en\b/i.test(String(value || ''))) {
        return LANG_EN;
      }
    }
    return LANG_RU;
  }

  const lang = detectLanguage();
  const isEnglish = lang === LANG_EN;
  document.documentElement.setAttribute('lang', lang);

  const RU_TO_EN: Record<string, string> = {
    'Выберите инструмент': 'Choose a tool',
    'Две утилиты в одном месте:': 'Two tools in one place:',
    'ASCII-конвертер и ретро-пиксельный конвертер.': 'ASCII converter and retro pixel converter.',
    'Набор готов': 'Toolset ready',
    'Превращает изображения в ASCII-графику, поддерживает наборы символов и': 'Converts images to ASCII art, supports character sets and',
    'экспорт.': 'export.',
    'Открыть →': 'Open →',
    'Конвертер в пиксель-арт с ретро-предустановками, шумом и сканлайном.': 'Pixel-art converter with retro presets, noise, and scanlines.',
    'файл.': 'file.',
    'Выбери инструмент и продолжай работу.': 'Pick a tool and continue.',

    'ASCII Конвертер': 'ASCII Converter',
    'Ретро Пиксель': 'Retro Pixel',
    'PIXEL Конвертер': 'PIXEL Converter',
    'Открыть панель настроек': 'Open settings panel',
    'Закрыть панель настроек': 'Close settings panel',
    'Изображение:': 'Image:',
    'Изображение': 'Image',
    'Изображения или папка': 'Images or folder',
    'Оригинал': 'Original',
    'Оригинал (выбранный файл)': 'Original (selected file)',
    'Удалить': 'Remove',
    'Удалить выбранный': 'Remove selected',
    'Перетащите изображение': 'Drag an image',
    'Перетащите фото/папку': 'Drag a photo/folder',
    'или нажмите для выбора': 'or click to choose',
    'Ctrl+V для вставки': 'Ctrl+V to paste',
    'Добавить файлы': 'Add files',
    'Добавить папку': 'Add folder',
    'Очистить очередь': 'Clear queue',
    'Очередь пуста': 'Queue is empty',
    'Очередь': 'Queue',
    'Добавьте файлы для обработки': 'Add files for processing',
    'Ширина (px):': 'Width (px):',
    'Набор символов:': 'Character set:',
    'Минимум ( .-+ )': 'Minimum ( .-+ )',
    'Небольшой ( .:-=+* )': 'Small ( .:-=+* )',
    'Средний ( .:-=+*iItVYX )': 'Medium ( .:-=+*iItVYX )',
    'Максимум ( .:-=+*iItVYXRBM# )': 'Maximum ( .:-=+*iItVYXRBM# )',
    'Свой набор...': 'Custom set...',
    'Символы от темного к светлому': 'Characters from dark to light',
    'Цвет:': 'Color:',
    'Цветной (PNG)': 'Color (PNG)',
    'Оранжевый (Matrix)': 'Orange (Matrix)',
    'Серый (Терминал)': 'Gray (Terminal)',
    '* В превью будет белым, в PNG — цветным.': '* White in preview, colored in PNG.',
    'Авто-контраст': 'Auto contrast',
    'Дизеринг': 'Dithering',
    'Сохранить': 'Save',
    'Скачать все (.zip)': 'Download all (.zip)',
    'Клик: зум | ЛКМ: перемещение | ESC: закрыть': 'Click: zoom | LMB: pan | ESC: close',
    'Пожалуйста, выберите изображение': 'Please select an image',
    'Текущий файл не GIF.': 'Current file is not a GIF.',
    'Кадры GIF недоступны. Нужен ImageDecoder или ../../shared/vendor/gifuct.js': 'GIF frames are unavailable. ImageDecoder or ../../shared/vendor/gifuct.js is required.',
    'Кадры GIF недоступны. Нужен ImageDecoder или gifuct.js.': 'GIF frames are unavailable. ImageDecoder or gifuct.js is required.',
    'Некорректная ширина.': 'Invalid width.',
    'Не удалось сохранить GIF.': 'Failed to save GIF.',
    'Нет данных для сохранения!': 'No data to save!',
    'Нет данных для копирования.': 'No data to copy.',
    'Не удалось скопировать в буфер обмена.': 'Failed to copy to clipboard.',
    'Некорректная ширина конвертации.': 'Invalid conversion width.',
    'Очередь пуста. Добавьте файлы или папку.': 'Queue is empty. Add files or a folder.',
    'Не удалось сформировать ни одного файла для архива.': 'Failed to build any files for archive.',
    'Сначала загрузите изображение!': 'Load an image first!',
    'Новых подходящих изображений не добавлено.': 'No new suitable images were added.',
    'Файл не выбран': 'No file selected',
    'Палитра': 'Palette',
    'Пиксель': 'Pixel',
    'Без': 'None',
    'Яркость': 'Brightness',
    'Контраст': 'Contrast',
    'Насыщенность': 'Saturation',
    'Шум': 'Noise',
    'Сканлайн': 'Scanlines',
    'Прозрачность': 'Transparency',
    'Сохранить PNG': 'Save PNG',
    'Сохранить GIF': 'Save GIF',
    'Загрузите изображение': 'Upload an image',
    'Файл загружен': 'File loaded',
    'выбран': 'selected',
    'сохранено': 'saved',
    'новый': 'new',
    'источника': 'source',
    'выбора файлов': 'file picker',
    'выбора папки': 'folder picker',
    'drag&drop': 'drag&drop',

    'Очистить': 'Clear'
  };

  const DYNAMIC_REPLACERS: DynamicReplacer[] = [
    {
      re: /Файлов в очереди:\s*(\d+)\.\s*Выбран:\s*([^.\n]+)\./g,
      fn: (_m, total, selected) => `Files in queue: ${total}. Selected: ${selected}.`,
    },
    {
      re: /Файлов в очереди:\s*(\d+)\./g,
      fn: (_m, total) => `Files in queue: ${total}.`,
    },
    {
      re: /Добавлено\s+(\d+)\s+файл\(ов\)\s+из\s+([^.\n]+)\.\s*Пропущено:\s*(\d+)\./g,
      fn: (_m, added, source, skipped) => `Added ${added} file(s) from ${source}. Skipped: ${skipped}.`,
    },
    {
      re: /Добавлено\s+(\d+)\s+файл\(ов\)\s+из\s+([^.\n]+)\./g,
      fn: (_m, added, source) => `Added ${added} file(s) from ${source}.`,
    },
    {
      re: /Архив создан\.\s*Успешно:\s*(\d+),\s*ошибок:\s*(\d+)\./g,
      fn: (_m, ok, err) => `Archive created. Success: ${ok}, errors: ${err}.`,
    }
  ];

  const PHRASES = Object.entries(RU_TO_EN).sort((a, b) => b[0].length - a[0].length);
  const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'alt'] as const;

  function hasCyrillic(text: unknown): boolean {
    return /[А-Яа-яЁё]/.test(String(text || ''));
  }

  function translateText(text: unknown): string {
    const original = String(text ?? '');
    if (!isEnglish || !hasCyrillic(original)) {
      return original;
    }

    let output = original;
    for (const [ru, en] of PHRASES) {
      if (output.includes(ru)) {
        output = output.split(ru).join(en);
      }
    }
    for (const { re, fn } of DYNAMIC_REPLACERS) {
      output = output.replace(re, fn);
    }
    return output;
  }

  function interpolate(template: string, params?: Record<string, unknown>): string {
    if (!params) return template;
    let output = String(template);
    for (const [key, value] of Object.entries(params)) {
      output = output.split(`{${key}}`).join(String(value));
    }
    return output;
  }

  function t(input: unknown, params?: Record<string, unknown>): string {
    const prepared = interpolate(String(input ?? ''), params);
    return isEnglish ? translateText(prepared) : prepared;
  }

  function translateTextNode(node: Node): void {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (!node.parentElement) return;
    const tag = node.parentElement.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    const translated = translateText(node.nodeValue);
    if (translated !== node.nodeValue) {
      node.nodeValue = translated;
    }
  }

  function translateAttributes(element: Element): void {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    for (const name of ATTRIBUTE_NAMES) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name);
      const translated = translateText(current);
      if (translated !== current) {
        element.setAttribute(name, translated);
      }
    }
  }

  function translateSubtree(root: Node): void {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return;
    }

    const element = root.nodeType === Node.ELEMENT_NODE ? root : document.documentElement;
    if (element instanceof Element) {
      translateAttributes(element);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      translateTextNode(current);
      current = walker.nextNode();
    }

    if (root instanceof Element || root instanceof Document) {
      const nodes = root.querySelectorAll('*');
      for (const node of nodes) {
        translateAttributes(node);
      }
    }
  }

  function observeDomChanges() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          translateTextNode(mutation.target);
          continue;
        }
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof Element) {
            translateAttributes(mutation.target);
          }
          continue;
        }
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            translateSubtree(node);
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTE_NAMES],
    });
  }

  function patchAlert() {
    if (!isEnglish || typeof window.alert !== 'function') return;
    const nativeAlert = window.alert.bind(window);
    window.alert = (message) => nativeAlert(translateText(String(message ?? '')));
  }

  if (isEnglish) {
    translateSubtree(document.documentElement);
    observeDomChanges();
    patchAlert();
  }

  window.AppI18n = {
    lang,
    isEnglish,
    t,
    translateText,
    apply: translateSubtree,
  };
})();

export {};
