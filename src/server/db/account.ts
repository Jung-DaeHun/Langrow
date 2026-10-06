import "server-only";
import type { Language, Level } from "@/lib/levels";
import type { ReadinessState } from "@/lib/readiness";
import { getAdminSupabase } from "@/services/supabase/admin";
import { callRpc } from "./rpc";
import type { DbResult } from "./types";

// /auth/callback: profiles 행이 없으면 만든다
export async function ensureProfile(userId: string): Promise<void> {
  await callRpc("ensure_profile", { p_user_id: userId });
}

// 최초 동의 시각을 유지한다
export async function agreeTerms(userId: string): Promise<void> {
  await callRpc("agree_terms", { p_user_id: userId });
}

export async function setFirstLevel(userId: string, language: Language, level: Level): Promise<DbResult<null>> {
  const result = await callRpc("set_first_level", { p_user_id: userId, p_language: language, p_level: level });
  return result.ok ? { ok: true, value: null } : result;
}

export async function switchLanguage(userId: string, language: Language): Promise<DbResult<null>> {
  const result = await callRpc("switch_language", { p_user_id: userId, p_language: language });
  return result.ok ? { ok: true, value: null } : result;
}

export async function lowerLevel(userId: string, language: Language, level: Level): Promise<DbResult<{ level: Level }>> {
  const result = await callRpc("lower_level", { p_user_id: userId, p_language: language, p_level: level });
  return result.ok ? { ok: true, value: { level: result.value.level as Level } } : result;
}

export async function startTrial(userId: string): Promise<DbResult<{ proUntil: Date }>> {
  const result = await callRpc("start_trial", { p_user_id: userId });
  return result.ok ? { ok: true, value: { proUntil: new Date(result.value.pro_until as string) } } : result;
}

// route() 래퍼의 준비 상태 검사용 읽기. 쓰기 RPC는 잠근 뒤 다시 확인한다
export async function getReadiness(userId: string): Promise<ReadinessState> {
  const admin = getAdminSupabase();
  const [profile, levels] = await Promise.all([
    admin.from("profiles").select("agreed_at, current_language").eq("id", userId).maybeSingle(),
    admin.from("user_levels").select("language, level").eq("user_id", userId),
  ]);
  if (profile.error) throw new Error(`profiles 조회 실패: ${profile.error.code} ${profile.error.message}`);
  if (levels.error) throw new Error(`user_levels 조회 실패: ${levels.error.code} ${levels.error.message}`);
  if (!profile.data) return { agreedAt: null, currentLanguage: null, levels: {} };

  return {
    agreedAt: profile.data.agreed_at === null ? null : new Date(profile.data.agreed_at),
    currentLanguage: profile.data.current_language as Language | null,
    levels: Object.fromEntries(levels.data.map((row) => [row.language, row.level])) as ReadinessState["levels"],
  };
}
