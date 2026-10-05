import { addDays } from "./usage";

// 1-data의 SQL 구현과 같은 규칙이어야 한다
export type StreakState = { lastStudyDate: string | null; streak: number };

export function nextStreak(state: StreakState, today: string): StreakState {
  if (state.lastStudyDate === today) return { lastStudyDate: today, streak: state.streak };
  if (state.lastStudyDate === addDays(today, -1)) return { lastStudyDate: today, streak: state.streak + 1 };
  return { lastStudyDate: today, streak: 1 };
}

export function displayStreak(state: StreakState, today: string): number {
  return state.lastStudyDate === today || state.lastStudyDate === addDays(today, -1) ? state.streak : 0;
}
