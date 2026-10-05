export const LANGUAGES = ["en", "ja"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = { en: "영어", ja: "일본어" };

export const LEVELS = [1, 2, 3, 4, 5] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_INFO: Record<Level, { name: string; description: string }> = {
  1: { name: "입문", description: "인사와 아주 쉬운 표현부터 시작해요" },
  2: { name: "초보", description: "짧은 문장으로 여행·일상 상황을 해결해요" },
  3: { name: "중급", description: "일상 대화를 자연스럽게 이어 가요" },
  4: { name: "상급", description: "업무 상황에서 뉘앙스까지 다듬어요" },
  5: { name: "고수", description: "원어민처럼 관용구와 격식을 자유롭게 써요" },
};

export function isLevel(n: number): n is Level {
  return (LEVELS as readonly number[]).includes(n);
}

export function showsFurigana(level: Level): boolean {
  return level <= 3;
}

export function opensTranslationByDefault(level: Level): boolean {
  return level <= 2;
}

export function allowsKoreanInput(level: Level): boolean {
  return level <= 2;
}

export function canTakeLevelTest(level: Level): boolean {
  return level <= 4;
}

export function showsKana(language: Language, level: Level): boolean {
  return language === "ja" && level <= 2;
}
