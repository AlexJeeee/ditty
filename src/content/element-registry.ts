const elementRegistry = new Map<string, Element>();
let elementCounter = 0;

export function clearElementRegistry() {
  elementRegistry.clear();
  elementCounter = 0;
}

export function registerElement(element: Element) {
  const existingId = [...elementRegistry.entries()].find(([, value]) => value === element)?.[0];
  if (existingId) {
    return existingId;
  }

  elementCounter += 1;
  const id = `el_${elementCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  elementRegistry.set(id, element);
  return id;
}

export function getRegisteredElement(id: string) {
  return elementRegistry.get(id) ?? null;
}

export function isRegisteredElementUsable(id: string) {
  const element = getRegisteredElement(id);
  return Boolean(element && document.contains(element));
}
