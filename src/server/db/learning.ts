import "server-only";
import type { Language, Level } from "@/lib/levels";
import type { AiFailureReason } from "@/services/claude/client";
import { getAdminSupabase } from "@/services/supabase/admin";
import { callRpc } from "./rpc";
import type { DbResult } from "./types";

// 학습 RPC (learning 마이그레이션). known/review 결정과 레벨업 채점은 2-api use-case가 lib로 하고,
// RPC는 판정이 끝난 값을 받는다

// CONSENT_REQUIRED, ONBOARDING_REQUIRED, INVALID_INPUT, LIMIT_REACHED.
// 전부 기존 단어면 한도와 무관하게 insertedCount 0으로 성공한다
export async function saveWordBatch(
  userId: string,
  language: Language,
  items: { wordId: string; status: "known" | "review" }[],
): Promise<DbResult<{ insertedCount: number }>> {
  const result = await callRpc("save_word_batch", {
    p_user_id: userId,
    p_language: language,
    p_items: items.map((item) => ({ word_id: item.wordId, status: item.status })),
  });
  return result.ok ? { ok: true, value: { insertedCount: result.value.inserted_count as number } } : result;
}

// CONSENT_REQUIRED, ONBOARDING_REQUIRED, INVALID_INPUT(학습 기록이 없거나 다른 언어의 단어)
export async function saveReview(
  userId: string,
  language: Language,
  items: { wordId: string; knew: boolean }[],
): Promise<DbResult<{ reviewedCount: number }>> {
  const result = await callRpc("save_review", {
    p_user_id: userId,
    p_language: language,
    p_items: items.map((item) => ({ word_id: item.wordId, knew: item.knew })),
  });
  return result.ok ? { ok: true, value: { reviewedCount: result.value.reviewed_count as number } } : result;
}

// CONSENT_REQUIRED, ONBOARDING_REQUIRED, INVALID_INPUT(from_level 1~4, 점수 0~20 밖),
// CONFLICT(실제 레벨이 fromLevel과 다름. 같은 시험 재제출 포함)
export async function submitLevelTest(
  userId: string,
  input: { language: Language; fromLevel: Level; score: number; passed: boolean },
): Promise<DbResult<{ passed: boolean; level: Level }>> {
  const result = await callRpc("submit_level_test", {
    p_user_id: userId,
    p_language: input.language,
    p_from_level: input.fromLevel,
    p_score: input.score,
    p_passed: input.passed,
  });
  return result.ok
    ? { ok: true, value: { passed: result.value.passed as boolean, level: result.value.level as Level } }
    : result;
}

// CONSENT_REQUIRED, ONBOARDING_REQUIRED, INVALID_INPUT(그 밖의 이름)
export async function recordEvent(userId: string, name: "pro_clicked" | "kana_studied"): Promise<DbResult<null>> {
  const result = await callRpc("record_event", { p_user_id: userId, p_name: name });
  return result.ok ? { ok: true, value: null } : result;
}

// 레벨업 채점용. 정답은 use-case가 parseBlank(example).answer로 얻는다. 없는 id는 결과에서 빠진다.
// words는 사용자 소유가 아닌 공용 카탈로그이고 로그인 사용자 누구나 RLS로 읽을 수 있는 테이블이라,
// 이 조회만 user_id 범위 없이 admin 클라이언트로 읽는다
export async function getWordsByIds(
  ids: string[],
): Promise<{ id: string; language: Language; level: Level; example: string }[]> {
  const { data, error } = await getAdminSupabase().from("words").select("id, language, level, example").in("id", ids);
  if (error) throw new Error(`words 조회 실패: ${error.code} ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    language: row.language as Language,
    level: row.level as Level,
    example: row.example,
  }));
}

// AI 정답 설명용 단어. 없으면 null. getWordsByIds처럼 공용 카탈로그라 user_id 범위 없이 읽는다
export type ExplainWord = {
  id: string;
  language: Language;
  level: Level;
  meaningKo: string;
  example: string;
  exampleKo: string;
  distractors: string[];
};

export async function getWord(id: string): Promise<ExplainWord | null> {
  const { data, error } = await getAdminSupabase()
    .from("words")
    .select("id, language, level, meaning_ko, example, example_ko, distractors")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`words 조회 실패: ${error.code} ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    language: data.language as Language,
    level: data.level as Level,
    meaningKo: data.meaning_ko,
    example: data.example,
    exampleKo: data.example_ko,
    distractors: data.distractors,
  };
}

// cached: 지금 단어 기준 저장본(AI를 부르지 않는다) / reserved: 사용 기록 id. AI가 실패하면 failWordExplanation에 넘긴다
export type BeginExplanationResult = { state: "cached"; explanation: string } | { state: "reserved"; eventId: number };

// CONSENT_REQUIRED, ONBOARDING_REQUIRED(단어 언어의 레벨 없음), NOT_FOUND(단어 없음),
// LIMIT_REACHED(Free 하루 10회), AI_FAILURE_LIMIT(저장본이 없고 오늘 실패 10회). choice는 복습이면 빈 문자열이다
export async function beginWordExplanation(
  userId: string,
  wordId: string,
  choice: string,
): Promise<DbResult<BeginExplanationResult>> {
  const result = await callRpc("begin_word_explanation", { p_user_id: userId, p_word_id: wordId, p_choice: choice });
  if (!result.ok) return result;
  const { value } = result;
  return value.state === "cached"
    ? { ok: true, value: { state: "cached", explanation: value.explanation as string } }
    : { ok: true, value: { state: "reserved", eventId: value.event_id as number } };
}

// 예약 행을 지우고 chat_failed(kind explain)를 남긴다. 이미 지웠거나 남의 id면 아무것도 바꾸지 않고 성공한다
export async function failWordExplanation(
  userId: string,
  eventId: number,
  reason: AiFailureReason,
): Promise<DbResult<null>> {
  const result = await callRpc("fail_word_explanation", { p_user_id: userId, p_event_id: eventId, p_reason: reason });
  return result.ok ? { ok: true, value: null } : result;
}

// 사용자와 무관한 공용 저장본이라 userId를 받지 않는다. NOT_FOUND(단어 없음).
// word는 설명을 만든 단어 내용이다. 그사이 단어를 고쳐 seed해 지금 단어와 다르면 저장하지 않고 성공한다
export async function saveWordExplanation(
  word: Pick<ExplainWord, "id" | "example" | "exampleKo" | "meaningKo">,
  choice: string,
  explanation: string,
): Promise<DbResult<null>> {
  const result = await callRpc("save_word_explanation", {
    p_word_id: word.id,
    p_choice: choice,
    p_explanation: explanation,
    p_example: word.example,
    p_example_ko: word.exampleKo,
    p_meaning_ko: word.meaningKo,
  });
  return result.ok ? { ok: true, value: null } : result;
}
