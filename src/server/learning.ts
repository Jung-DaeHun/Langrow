import "server-only";
import { parseBlank } from "@/lib/blank";
import { isPassed, LEVEL_TEST_SIZE, scoreAnswers } from "@/lib/levelTest";
import type { Language, Level } from "@/lib/levels";
import { wordStatus } from "@/lib/wordBatch";
import type { LevelUpResponse, WordBatchResponse } from "@/types/api";
import type { Deps } from "./deps";
import type { Outcome } from "./http";

// 학습 use-case. 클라이언트가 보낸 상태·점수는 받지 않고 lib로 판정한다.
// 한도·중복 단어·실제 레벨 확인·레벨 +1은 RPC가 계정을 잠근 뒤 한다

export async function saveWords(
  deps: Deps,
  userId: string,
  input: { language: Language; items: { word_id: string; knew: boolean; correct: boolean }[] },
): Promise<Outcome<WordBatchResponse>> {
  const items = input.items.map((item) => ({ wordId: item.word_id, status: wordStatus(item.knew, item.correct) }));
  return deps.db.saveWordBatch(userId, input.language, items);
}

// seed 검증을 통과한 단어라 정답을 꺼낼 수 없으면 데이터 버그다
function correctAnswer(word: { id: string; example: string }): string {
  const blank = parseBlank(word.example);
  if (!blank) throw new Error(`예문에 빈칸이 없습니다 (${word.id})`);
  return blank.answer;
}

export async function submitLevelUp(
  deps: Deps,
  userId: string,
  input: { language: Language; from_level: Level; answers: { word_id: string; answer: string }[] },
): Promise<Outcome<LevelUpResponse>> {
  // 제출한 단어가 모두 그 언어·from_level의 단어여야 한다. 실제 레벨이 from_level인지는 RPC가 확인한다
  const words = await deps.db.getWordsByIds(input.answers.map((a) => a.word_id));
  if (
    words.length < LEVEL_TEST_SIZE ||
    words.some((w) => w.language !== input.language || w.level !== input.from_level)
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const correctById = new Map(words.map((w) => [w.id, correctAnswer(w)]));
  const { score, wrongIds } = scoreAnswers(input.answers, correctById);
  const submitted = await deps.db.submitLevelTest(userId, {
    language: input.language,
    fromLevel: input.from_level,
    score,
    passed: isPassed(score),
  });
  if (!submitted.ok) return submitted;

  // 정답은 제출 뒤에만 보낸다
  const wrong = wrongIds.map((wordId) => ({ wordId, answer: correctById.get(wordId) ?? "" }));
  return { ok: true, value: { ...submitted.value, score, wrong } };
}
