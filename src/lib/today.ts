import { canTakeLevelTest, type Level } from "./levels";

// 목표는 플랜과 무관하다. Pro는 목표를 넘어 더 할 수 있을 뿐이다
export const DAILY_WORD_GOAL = 10;
export const VALID_SESSION_TURNS = 3;

// 종료 여부와 무관하게 성공한 턴 수로만 판단한다
export function isValidSession(doneTurns: number): boolean {
  return doneTurns >= VALID_SESSION_TURNS;
}

export type WordGoal = { progress: number; done: boolean; exhausted: boolean };

export function wordGoal(newWordsToday: number, unseenInLevel: number): WordGoal {
  return {
    progress: Math.min(newWordsToday, DAILY_WORD_GOAL),
    done: newWordsToday >= DAILY_WORD_GOAL,
    exhausted: unseenInLevel === 0,
  };
}

export function remainingGoalCount(word: WordGoal, chatDone: boolean): number {
  return (word.done || word.exhausted ? 0 : 1) + (chatDone ? 0 : 1);
}

// 새 단어 소진 안내 버튼(spec/words.md "새 단어 소진"). 고수는 레벨업이 없고, 오답이 없으면 복습 대신 대화로 보낸다
export type ExhaustedAction = "level-up" | "review" | "chat";

export function exhaustedActions(level: Level, reviewCount: number): ExhaustedAction[] {
  const hasReview = reviewCount > 0;
  if (canTakeLevelTest(level)) return hasReview ? ["level-up", "review"] : ["level-up", "chat"];
  return hasReview ? ["review", "chat"] : ["chat"];
}
