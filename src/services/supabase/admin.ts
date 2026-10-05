import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAdminEnv } from "@/services/env";

let client: SupabaseClient | undefined;

// secret key 클라이언트는 RLS를 우회한다. 모든 조회·변경에 user_id를 건다.
// env 없이도 next build가 통과하도록 첫 호출 때 만든다
export function getAdminSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseSecretKey } = getAdminEnv();
    client = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
