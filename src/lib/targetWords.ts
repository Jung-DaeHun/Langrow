// 배운 단어 써 보기(spec/chat.md "배운 단어 써 보기"). AI가 준 번호를 단어 id로 바꾼다.
// 맞지 않는 번호는 실패로 보지 않고 버린다. 턴은 성공으로 처리한다
export type TargetSource = "today" | "recent";
// 예약 RPC가 첫 턴에 주는 후보. usedToday는 오늘 이 계정의 대화에서 이미 쓴 단어인지
export type WordCandidate = { id: string; word: string; reading: string | null; meaningKo: string; usedToday: boolean };
// 세션의 목표 단어와 이 세션에서 썼는지
export type TargetWord = { id: string; word: string; reading: string | null; meaningKo: string; used: boolean };

export const TARGET_WORDS_MAX = 5;
export const TARGET_SOURCE_NAMES: Record<TargetSource, string> = { today: "오늘 단어", recent: "최근 단어" };

// 1부터 붙인 번호를 id로 바꾼다. 정수가 아니거나 범위 밖인 번호와 중복은 버리고 AI가 준 순서를 지킨다
function idsAt(ids: readonly string[], numbers: readonly number[]): string[] {
  const picked: string[] = [];
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > ids.length) continue;
    const id = ids[n - 1];
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

export function pickTargetIds(candidateIds: readonly string[], numbers: readonly number[]): string[] {
  return idsAt(candidateIds, numbers).slice(0, TARGET_WORDS_MAX);
}

// 첫 턴은 listIds가 후보 id, targetIds가 pickTargetIds 결과다. 그 뒤 턴은 둘 다 목표 단어 id다
export function pickUsedIds(
  listIds: readonly string[],
  numbers: readonly number[],
  targetIds: readonly string[],
): string[] {
  return idsAt(listIds, numbers).filter((id) => targetIds.includes(id));
}
