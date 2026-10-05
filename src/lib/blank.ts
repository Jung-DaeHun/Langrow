export type BlankParts = { before: string; answer: string; after: string };

// 단어 예문의 `{{정답}}`이 정확히 1개이고 안이 비어 있지 않을 때만 나눈다
export function parseBlank(example: string): BlankParts | null {
  const start = example.indexOf("{{");
  const end = example.indexOf("}}", start + 2);
  if (start < 0 || end < 0) return null;
  const parts = { before: example.slice(0, start), answer: example.slice(start + 2, end), after: example.slice(end + 2) };
  const hasMarker = Object.values(parts).some((s) => s.includes("{{") || s.includes("}}"));
  if (hasMarker || parts.answer.trim() === "") return null;
  return parts;
}

// 정답 + 오답을 Fisher–Yates로 섞는다. 테스트는 random을 주입한다
export function buildOptions(answer: string, distractors: readonly string[], random: () => number = Math.random): string[] {
  const options = [answer, ...distractors];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

// 4지선다라 정규화 없이 표기 그대로 비교한다 (후리가나 표기도 정답 문자열의 일부다)
export function isCorrectChoice(choice: string, answer: string): boolean {
  return choice === answer;
}
