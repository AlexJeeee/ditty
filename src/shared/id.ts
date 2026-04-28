export function createScopedId(prefix: string, randomLength = 8) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 2 + randomLength)}`;
}
