const PREFIX = 'hania:bookmark:v1:';
export function clampPage(value, total) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(total, Math.max(1, Math.trunc(number))) : 1;
}
export function readProgress(storage, id, total) {
  try {
    const saved = JSON.parse(storage.getItem(PREFIX + id));
    if (!saved || !Number.isInteger(saved.page) || saved.page < 1 || !Number.isFinite(saved.updatedAt)) return null;
    return { page: clampPage(saved.page, total), updatedAt: saved.updatedAt };
  } catch { return null; }
}
export function saveProgress(storage, id, page) {
  try {
    storage.setItem(PREFIX + id, JSON.stringify({ page, updatedAt: Date.now() }));
    return true;
  } catch { return false; }
}
