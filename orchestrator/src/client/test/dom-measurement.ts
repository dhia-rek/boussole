type ElementMeasurement = {
  width: number;
  height: number;
  top?: number;
  left?: number;
};

type ResizeObserverCallbackEntry = {
  callback: ResizeObserverCallback;
  elements: Set<Element>;
};

const resizeObserverEntries = new Set<ResizeObserverCallbackEntry>();
const elementMeasurements = new WeakMap<Element, ElementMeasurement>();

class MockResizeObserver implements ResizeObserver {
  readonly #entry: ResizeObserverCallbackEntry;

  constructor(callback: ResizeObserverCallback) {
    this.#entry = {
      callback,
      elements: new Set(),
    };
    resizeObserverEntries.add(this.#entry);
  }

  disconnect() {
    this.#entry.elements.clear();
    resizeObserverEntries.delete(this.#entry);
  }

  observe(target: Element) {
    this.#entry.elements.add(target);
  }

  unobserve(target: Element) {
    this.#entry.elements.delete(target);
  }
}

const defineDimensionProperty = (
  target: object,
  key: string,
  value: number,
) => {
  Object.defineProperty(target, key, {
    configurable: true,
    get: () => value,
  });
};

const getMeasurement = (element: Element): ElementMeasurement => {
  return (
    elementMeasurements.get(element) ?? {
      width: 0,
      height: 0,
      top: 0,
      left: 0,
    }
  );
};

export const mockElementMeasurement = (
  element: Element,
  measurement: ElementMeasurement,
) => {
  const next = {
    top: 0,
    left: 0,
    ...measurement,
  };

  elementMeasurements.set(element, next);

  if (element instanceof HTMLElement) {
    defineDimensionProperty(element, "offsetWidth", next.width);
    defineDimensionProperty(element, "offsetHeight", next.height);
    defineDimensionProperty(element, "clientWidth", next.width);
    defineDimensionProperty(element, "clientHeight", next.height);
    defineDimensionProperty(element, "scrollWidth", next.width);
    defineDimensionProperty(element, "scrollHeight", next.height);
  }

  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: next.left,
        y: next.top,
        top: next.top,
        left: next.left,
        width: next.width,
        height: next.height,
        right: next.left + next.width,
        bottom: next.top + next.height,
        toJSON: () => undefined,
      }) satisfies DOMRect,
  });
};

export const installDomMeasurementMocks = () => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  });
};
