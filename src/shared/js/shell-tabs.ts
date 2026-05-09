(() => {
  type ToolId = 'ascii' | 'pixel' | 'resize';

  function isToolId(value: string | null): value is ToolId {
    return value === 'ascii' || value === 'pixel' || value === 'resize';
  }

  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool-tab]'));
  if (!tabs.length) return;

  const panelByTool: Record<ToolId, HTMLElement | null> = {
    ascii: document.getElementById('panel-ascii'),
    pixel: document.getElementById('panel-pixel'),
    resize: document.getElementById('panel-resize'),
  };

  const frameByTool: Record<ToolId, HTMLIFrameElement | null> = {
    ascii: document.getElementById('frame-ascii') as HTMLIFrameElement | null,
    pixel: document.getElementById('frame-pixel') as HTMLIFrameElement | null,
    resize: document.getElementById('frame-resize') as HTMLIFrameElement | null,
  };

  function ensureFrameLoaded(tool: ToolId): void {
    const frame = frameByTool[tool];
    if (!frame) return;
    if (frame.getAttribute('src')) return;
    const lazySrc = frame.getAttribute('data-src');
    if (lazySrc) {
      frame.setAttribute('src', lazySrc);
    }
  }

  function activate(tool: ToolId): void {
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute('data-tool-tab') === tool;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    Object.entries(panelByTool).forEach(([name, panel]) => {
      if (!panel) return;
      panel.hidden = name !== tool;
      panel.classList.toggle('is-active', name === tool);
    });

    ensureFrameLoaded(tool);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tool = tab.getAttribute('data-tool-tab');
      if (isToolId(tool)) activate(tool);
    });
  });

  activate('ascii');
})();

export {};
