import "server-only";
import type { Language, Level } from "@/lib/levels";
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
