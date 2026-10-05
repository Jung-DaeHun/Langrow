// 한국은 서머타임이 없어서 UTC+9로 고정 계산한다
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function kstDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+09:00`);
}

export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function remaining(used: number, limit: number): number {
  return Math.max(0, limit - used);
}
