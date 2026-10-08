import "server-only";
import { parseBlank } from "@/lib/blank";
import { isPassed, LEVEL_TEST_SIZE, scoreAnswers } from "@/lib/levelTest";
import type { Language, Level } from "@/lib/levels";
import { wordStatus } from "@/lib/wordBatch";
import type { LevelUpResponse, WordBatchResponse, WordExplainResponse } from "@/types/api";
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

export const EXPLAIN_UNAVAILABLE_MESSAGE = "설명을 만들지 못했어요. 횟수는 차감되지 않았어요.";
// 실패 횟수는 대화와 같이 세지만, 공용 문구("대화를 잠시 쉬어요")는 설명 자리에 맞지 않아 바꾼다
export const EXPLAIN_FAILURE_LIMIT_MESSAGE = "오늘은 응답 오류가 많아 AI 해설을 잠시 쉬어요. 내일 다시 시도해 주세요.";

// AI 정답 설명(spec/words.md "AI 정답 설명"). 예문·보기는 클라이언트에서 받지 않고 DB 단어로 검증하고 프롬프트를 만든다.
// 한도·저장본·실패 횟수는 예약 RPC가 계정을 잠근 뒤 판정한다. 예약한 이벤트 행이 곧 사용 기록이라 확정 단계는 없다
export async function explainWord(
  deps: Deps,
  userId: string,
  input: { word_id: string; choice?: string },
): Promise<Outcome<WordExplainResponse>> {
  const word = await deps.db.getWord(input.word_id);
  if (!word) return { ok: false, code: "NOT_FOUND" };
  // seed 검증을 통과한 단어라 빈칸이 없으면 데이터 버그다
  const blank = parseBlank(word.example);
  if (!blank) throw new Error(`예문에 빈칸이 없습니다 (${word.id})`);

  const choice = input.choice ?? null;
  if (choice !== null && choice !== blank.answer && !word.distractors.includes(choice)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const key = choice ?? ""; // 저장 키. 복습은 빈 문자열이다

  const reserved = await deps.db.beginWordExplanation(userId, word.id, key);
  if (!reserved.ok) {
    return reserved.code === "AI_FAILURE_LIMIT" ? { ...reserved, message: EXPLAIN_FAILURE_LIMIT_MESSAGE } : reserved;
  }
  if (reserved.value.state === "cached") return { ok: true, value: { explanation: reserved.value.explanation } };

  const generated = await deps.ai.generateExplanation({
    language: word.language,
    level: word.level,
    sentence: blank.before + blank.answer + blank.after,
    exampleKo: word.exampleKo,
    answer: blank.answer,
    meaningKo: word.meaningKo,
    choice,
  });
  if (!generated.ok) {
    const failed = await deps.db.failWordExplanation(userId, reserved.value.eventId, generated.reason);
    return failed.ok ? { ok: false, code: "AI_UNAVAILABLE", message: EXPLAIN_UNAVAILABLE_MESSAGE } : failed;
  }

  const { explanation } = generated.value;
  await saveExplanation(deps, word.id, key, explanation);
  return { ok: true, value: { explanation } };
}

// 저장은 다음 요청을 위한 것이라 실패해도 이 응답을 막지 않는다. 로그에 설명 내용·고른 보기를 남기지 않는다
async function saveExplanation(deps: Deps, wordId: string, choice: string, explanation: string): Promise<void> {
  try {
    const saved = await deps.db.saveWordExplanation(wordId, choice, explanation);
    if (!saved.ok) console.error(JSON.stringify({ explain: "save_failed", wordId, code: saved.code }));
  } catch (error) {
    console.error(
      JSON.stringify({ explain: "save_failed", wordId, error: error instanceof Error ? error.message : String(error) }),
    );
  }
}
