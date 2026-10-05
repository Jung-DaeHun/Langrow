import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/services/env";

// Server Component·route에서 쿠키 기반으로 읽기와 getUser()를 한다. 요청마다 새로 만든다
export async function getServerSupabase(): Promise<SupabaseClient> {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
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
