import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/services/env";
import type { Database } from "@/types/database";

// Server Component·route에서 쿠키 기반으로 읽기와 getUser()를 한다. 요청마다 새로 만든다
// 쿠키를 env 검증보다 먼저 읽는다. 그래야 env 없는 next build에서도 보호 페이지가 동적 페이지로 판정된다
export async function getServerSupabase(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Component에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy가 맡는다
        }
      },
    },
  });
}
