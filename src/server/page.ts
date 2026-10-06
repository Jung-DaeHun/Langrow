import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Language, Level } from "@/lib/levels";
import { checkReadiness } from "@/lib/readiness";
import { readAccount, readTodayUsage, type AccountState, type TodayUsage } from "@/server/db/reads";
import { getServerSupabase } from "@/services/supabase/server";
import type { Database } from "@/types/database";

// 보호 페이지 공통 가드. cache()로 감싸서 (app) 레이아웃과 페이지가 한 요청에서 같이 불러도 조회는 한 번이다

export type PageUser = { userId: string; email: string | null; supabase: SupabaseClient<Database> };
export type ReadyPage = PageUser & { account: AccountState; language: Language; level: Level; now: Date };

// 쿠키의 세션을 그대로 믿지 않고 getUser()로 토큰을 검증해 판단한다
export const requireUser = cache(async (): Promise<PageUser> => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/");
  return { userId: data.user.id, email: data.user.email ?? null, supabase };
});

// /onboarding용. 준비 상태와 무관하게 이동하지 않는다
export const loadAccount = cache(async (): Promise<PageUser & { account: AccountState }> => {
  const user = await requireUser();
  return { ...user, account: await readAccount(user.supabase, user.userId) };
});

// now는 이 요청의 표시 기준 시각이다. 페이지는 표시 계산에 이 값만 쓴다
export const requireReady = cache(async (): Promise<ReadyPage> => {
  const page = await loadAccount();
  const language = page.account.currentLanguage;
  const level = language === null ? undefined : page.account.levels[language];
  if (checkReadiness(page.account, "ready") !== "ok" || language === null || level === undefined) {
    redirect("/onboarding");
  }
  return { ...page, language, level, now: new Date() };
});

export const loadTodayUsage = cache(async (): Promise<TodayUsage> => {
  const { supabase, userId, now } = await requireReady();
  return readTodayUsage(supabase, userId, now);
});
