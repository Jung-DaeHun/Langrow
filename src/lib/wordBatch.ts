export const BATCH_MAX = 10;

export function batchSize(remainingToday: number, unseenCount: number): number {
  return Math.max(0, Math.min(BATCH_MAX, remainingToday, unseenCount));
}

export function wordStatus(knew: boolean, correct: boolean): "known" | "review" {
  return knew && correct ? "known" : "review";
}

export function newWordIds(itemIds: readonly string[], existingIds: ReadonlySet<string>): string[] {
  return itemIds.filter((id) => !existingIds.has(id));
}

export function hasValidBatchIds(ids: readonly string[]): boolean {
  return ids.length >= 1 && ids.length <= BATCH_MAX && new Set(ids).size === ids.length;
}
