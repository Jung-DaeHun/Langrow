import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/services/env";

let client: SupabaseClient | undefined;

// 로그인·로그아웃 전용이다. 데이터 읽기는 페이지, 쓰기는 /api에서 한다
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
    client = createBrowserClient(supabaseUrl, supabasePublishableKey);
  }
  return client;
}
