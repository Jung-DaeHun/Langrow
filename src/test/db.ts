import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Language, Level } from "@/lib/levels";
import { agreeTerms, ensureProfile, setFirstLevel } from "@/server/db/account";
import { getPublicEnv } from "@/services/env";
import { getAdminSupabase } from "@/services/supabase/admin";
import type { Database } from "@/types/database";

// test:db 보조. env는 dbGlobalSetup이 넣는다

const PASSWORD = "langrow-test-password";

export type TestUser = { id: string; email: string };

// 이 테스트 파일에서 만든 사용자. deleteTestUsers()로 한 번에 지운다
const created: string[] = [];

// auth 사용자만 만든다 (profiles 행 없음)
export async function createTestUser(): Promise<TestUser> {
  const email = `test-${randomUUID()}@example.com`;
  const { data, error } = await getAdminSupabase().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email };
}

// 동의 + 첫 레벨까지 마친 사용자
export async function createReadyUser(language: Language = "en", level: Level = 1): Promise<TestUser> {
  const user = await createTestUser();
  await ensureProfile(user.id);
  await agreeTerms(user.id);
  const result = await setFirstLevel(user.id, language, level);
  if (!result.ok) throw new Error(`setFirstLevel 실패: ${result.code}`);
  return user;
}

// auth 사용자를 지우면 FK cascade로 모든 사용자 행이 지워진다
export async function deleteTestUser(id: string): Promise<void> {
  const index = created.indexOf(id);
  if (index !== -1) created.splice(index, 1);
  const { error } = await getAdminSupabase().auth.admin.deleteUser(id);
  if (error) throw error;
}

export async function deleteTestUsers(): Promise<void> {
  for (const id of [...created]) await deleteTestUser(id);
}

function publicClient(): SupabaseClient<Database> {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient<Database> {
  return publicClient();
}

export async function signedInClient(user: TestUser): Promise<SupabaseClient<Database>> {
  const client = publicClient();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error) throw error;
  return client;
}
