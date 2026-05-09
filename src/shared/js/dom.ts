type ElementConstructor<T extends Element> = {
  new (): T;
};

export function requireElement<T extends HTMLElement>(
  id: string,
  constructor: ElementConstructor<T>,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Required element #${id} is missing or has an unexpected type.`);
  }
  return element;
}

export function requireQuery<T extends HTMLElement>(
  selector: string,
  constructor: ElementConstructor<T>,
): T {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Required element ${selector} is missing or has an unexpected type.`);
  }
  return element;
}

export function optionalElement<T extends HTMLElement>(
  id: string,
  constructor: ElementConstructor<T>,
): T | null {
  const element = document.getElementById(id);
  if (element === null) return null;
  if (!(element instanceof constructor)) {
    throw new Error(`Element #${id} has an unexpected type.`);
  }
  return element;
}

export function canvasContext2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", options);
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  return context;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
