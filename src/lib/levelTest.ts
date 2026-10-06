export const LEVEL_TEST_SIZE = 20;
export const PASS_SCORE = 16;

export function hasValidTestIds(ids: readonly string[]): boolean {
  return ids.length === LEVEL_TEST_SIZE && new Set(ids).size === ids.length;
}

// 정답 표기와 문자열을 그대로 비교한다 (4지선다라 정규화가 필요 없다)
export function scoreAnswers(
  answers: readonly { word_id: string; answer: string }[],
  correctById: ReadonlyMap<string, string>,
): { score: number; wrongIds: string[] } {
  const wrongIds = answers.filter((a) => correctById.get(a.word_id) !== a.answer).map((a) => a.word_id);
  return { score: answers.length - wrongIds.length, wrongIds };
}

export function isPassed(score: number): boolean {
  return score >= PASS_SCORE;
}

// 앞 LEVEL_TEST_SIZE칸만 섞는 Fisher–Yates로 중복 없이 고른다. 테스트는 random을 주입한다
export function pickTestWords<T>(words: readonly T[], random: () => number = Math.random): T[] | null {
  if (words.length < LEVEL_TEST_SIZE) return null;
  const pool = [...words];
  for (let i = 0; i < LEVEL_TEST_SIZE; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, LEVEL_TEST_SIZE);
}
