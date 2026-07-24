/**
 * Index math for list/card ordering. Entities carry a dense integer
 * `index` per container; moves renumber the affected containers.
 * Pure functions here so the logic is unit-testable without a DB.
 */

export interface Indexed {
  id: number;
  index: number;
}

/** Remove `id` from `items` and renumber densely (0..n-1). */
export function removeAndRenumber<T extends Indexed>(
  items: T[],
  id: number,
): T[] {
  return items
    .filter((i) => i.id !== id)
    .sort((a, b) => a.index - b.index)
    .map((item, index) => ({ ...item, index }));
}

/** Insert `item` at `position` (clamped) and renumber densely. */
export function insertAndRenumber<T extends Indexed>(
  items: T[],
  item: T,
  position: number,
): T[] {
  const sorted = items
    .filter((i) => i.id !== item.id)
    .sort((a, b) => a.index - b.index);
  const clamped = Math.max(0, Math.min(position, sorted.length));
  sorted.splice(clamped, 0, item);
  return sorted.map((entry, index) => ({ ...entry, index }));
}

/**
 * Compute the renumbering for moving `id` to `position` within the same
 * container, or into `target` when provided. Returns only entries whose
 * index actually changed, ready for batched UPDATEs.
 */
export function computeMove<T extends Indexed>(opts: {
  source: T[];
  target?: T[];
  id: number;
  position: number;
}): { source: T[]; target: T[] } {
  const { source, target, id, position } = opts;
  const moving = source.find((i) => i.id === id);
  if (!moving) return { source: [], target: [] };

  if (!target) {
    const next = insertAndRenumber(source, moving, position);
    return { source: diffIndexes(source, next), target: [] };
  }

  const nextSource = removeAndRenumber(source, id);
  const nextTarget = insertAndRenumber(target, moving, position);
  return {
    source: diffIndexes(source, nextSource),
    target: diffIndexes(target, nextTarget, true),
  };
}

function diffIndexes<T extends Indexed>(
  before: T[],
  after: T[],
  includeAll = false,
): T[] {
  const prev = new Map(before.map((i) => [i.id, i.index]));
  return after.filter(
    (i) => includeAll || prev.get(i.id) !== i.index || !prev.has(i.id),
  );
}
