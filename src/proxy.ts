import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPage } from "@/lib/paths";
import { getPublicEnv } from "@/services/env";
import type { Database } from "@/types/database";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// 페이지 요청마다 Supabase 세션을 갱신하고, 비로그인 사용자를 보호 페이지에서 /로 보낸다.
// 동의·레벨에 따른 /onboarding 이동은 페이지가 한다 (여기서 DB를 조회하지 않는다)
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  let refreshed: CookieToSet[] = [];
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // 갱신된 쿠키는 다음 요청(Server Component)과 응답 양쪽에 싣는다.
      // 인증 쿠키를 쓰는 응답은 CDN에 캐시되면 안 되므로 받은 캐시 금지 헤더도 함께 싣는다
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        refreshed = cookiesToSet;
        cacheHeaders = headers;
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const response =
    !user && isProtectedPage(request.nextUrl.pathname)
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next({ request });
  for (const { name, value, options } of refreshed) response.cookies.set(name, value, options);
  for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
  return response;
}

// /api/**는 route 래퍼의 getUser()가 인증과 세션 갱신을 하므로 뺀다 (Auth 서버 왕복을 한 번으로)
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
