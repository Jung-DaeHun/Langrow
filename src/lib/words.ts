import { parseBlank } from "./blank";
import type { Language, Level } from "./levels";

export const WORDS_PER_LEVEL = 200;

// data/words/*.json의 항목이자 words 테이블 행 (키 이름이 DB 컬럼과 같다)
export type WordEntry = {
  id: string;
  language: Language;
  level: Level;
  rank: number;
  word: string;
  reading: string | null;
  meaning_ko: string;
  example: string;
  example_ko: string;
  distractors: string[];
};

const STRING_FIELDS = ["id", "word", "meaning_ko", "example", "example_ko"] as const;

export function wordId(language: Language, level: Level, rank: number): string {
  return `${language}-${level}-${String(rank).padStart(3, "0")}`;
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// 단어 하나만 보고 알 수 있는 규칙. 파일 전체 규칙(개수, rank·word 중복)은 validateWordFile이 본다
export function wordEntryErrors(language: Language, level: Level, item: unknown): string[] {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return ["객체가 아닙니다"];
  const w = item as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of STRING_FIELDS) {
    if (!isFilled(w[key])) errors.push(`${key} 값이 비어 있습니다`);
  }
  if (w.language !== language) errors.push(`language가 파일과 다릅니다 (파일: ${language})`);
  if (w.level !== level) errors.push(`level이 파일과 다릅니다 (파일: ${level})`);

  const rank = w.rank;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > WORDS_PER_LEVEL) {
    errors.push(`rank가 1~${WORDS_PER_LEVEL}의 정수가 아닙니다`);
  } else if (w.id !== wordId(language, level, rank)) {
    errors.push(`id가 rank와 맞지 않습니다 (기대값: ${wordId(language, level, rank)})`);
  }

  const blank = typeof w.example === "string" ? parseBlank(w.example) : null;
  if (!blank) errors.push("example에 {{ }}가 정확히 1개 있어야 합니다");

  const distractors = w.distractors;
  if (!Array.isArray(distractors) || distractors.length !== 3 || !distractors.every(isFilled)) {
    errors.push("distractors는 비어 있지 않은 문자열 3개여야 합니다");
  } else {
    if (new Set(distractors).size !== 3) errors.push("distractors끼리 같은 보기가 있습니다");
    if (blank && distractors.includes(blank.answer)) errors.push(`distractors에 정답이 있습니다 (${blank.answer})`);
  }

  if (language === "ja" && !isFilled(w.reading)) errors.push("일본어는 reading(히라가나 읽기)이 있어야 합니다");
  if (language === "en" && w.reading !== null) errors.push("영어는 reading이 null이어야 합니다");
  return errors;
}

// 오류마다 단어 id와 이유를 적는다. 사람이 검수하며 고친다
export function validateWordFile(
  language: Language,
  level: Level,
  data: unknown,
): { ok: true; words: WordEntry[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(data)) return { ok: false, errors: ["단어 파일은 배열이어야 합니다"] };

  const errors: string[] = [];
  if (data.length !== WORDS_PER_LEVEL) {
    errors.push(`단어가 ${data.length}개입니다. ${WORDS_PER_LEVEL}개여야 합니다`);
  }
  const words: WordEntry[] = [];
  const ranks = new Set<number>();
  const seenWords = new Set<string>();

  data.forEach((item: unknown, index) => {
    const w = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const label = isFilled(w.id) ? w.id : `${index + 1}번째 항목`;
    const reasons = wordEntryErrors(language, level, item);
    if (typeof w.rank === "number") {
      if (ranks.has(w.rank)) reasons.push(`rank가 중복됩니다 (${w.rank})`);
      ranks.add(w.rank);
    }
    if (isFilled(w.word)) {
      if (seenWords.has(w.word)) reasons.push(`word가 중복됩니다 (${w.word})`);
      seenWords.add(w.word);
    }

    errors.push(...reasons.map((reason) => `${label}: ${reason}`));
    if (reasons.length === 0) {
      // 알 수 없는 키는 upsert에 넘기지 않도록 DB 컬럼만 담는다
      words.push({
        id: w.id as string,
        language,
        level,
        rank: w.rank as number,
        word: w.word as string,
        reading: w.reading as string | null,
        meaning_ko: w.meaning_ko as string,
        example: w.example as string,
        example_ko: w.example_ko as string,
        distractors: w.distractors as string[],
      });
    }
  });

  const missing = Array.from({ length: WORDS_PER_LEVEL }, (_, i) => i + 1).filter((rank) => !ranks.has(rank));
  if (missing.length > 0) errors.push(`빠진 rank: ${missing.join(", ")}`);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, words };
}
