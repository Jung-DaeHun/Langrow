import { NextResponse, type NextRequest } from "next/server";
import { getDeps } from "@/server/deps";
import { getServerSupabase } from "@/services/supabase/server";

// 구글 OAuth 콜백. 이동 경로는 고정이다: next·redirect_to 같은 파라미터를 읽지 않는다 (오픈 리디렉트 방지).
// 준비 상태(동의·레벨)에 따른 /onboarding 이동은 /home이 한다
export async function GET(request: NextRequest): Promise<NextResponse> {
  const failed = new URL("/?login=failed", request.url);
  // 구글에서 취소하면 code 없이 error 파라미터만 붙어 돌아온다
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(failed);

  const { data, error } = await (await getServerSupabase()).auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(failed);

  try {
    await getDeps().db.ensureProfile(data.user.id);
  } catch (error) {
    // 로그인은 됐지만 profiles 행을 못 만들었다. 다시 로그인하면 다시 만들고, 온보딩의 동의(agree_terms)도 행을 만든다
    console.error(
      JSON.stringify({
        path: "/auth/callback",
        userId: data.user.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.redirect(failed);
  }
  return NextResponse.redirect(new URL("/home", request.url));
}
