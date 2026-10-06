import type { Language, Level } from "@/lib/levels";
import { WORDS_PER_LEVEL, wordId, type WordEntry } from "@/lib/words";

// 규칙을 모두 지키는 단어 1개. 내용은 rank로 구분만 한다
export function validWord(language: Language, level: Level, rank: number): WordEntry {
  const base = { id: wordId(language, level, rank), language, level, rank, example_ko: "학교에 갔다." };
  if (language === "en") {
    return {
      ...base,
      word: `go${rank}`,
      reading: null,
      meaning_ko: `가다${rank}`,
      example: `I {{went${rank}}} to school.`,
      distractors: [`goes${rank}`, `gone${rank}`, `going${rank}`],
    };
  }
  return {
    ...base,
    word: `行く${rank}`,
    reading: `いく${rank}`,
    meaning_ko: `가다${rank}`,
    example: `[学校|がっこう]に{{[行|い]った${rank}}}。`,
    distractors: [`[行|い]く${rank}`, `[行|い]って${rank}`, `[行|い]かない${rank}`],
  };
}

// 검사를 통과하는 단어 파일 하나 (rank 1~200)
export function validWordFile(language: Language, level: Level): WordEntry[] {
  return Array.from({ length: WORDS_PER_LEVEL }, (_, i) => validWord(language, level, i + 1));
}
