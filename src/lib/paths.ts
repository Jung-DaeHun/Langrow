// 비로그인이면 proxy가 /로 보내는 페이지. 그 밖의 페이지(/, /privacy, /terms, /auth/callback)는 공개다
export const PROTECTED_PAGES: readonly string[] = [
  "/onboarding",
  "/home",
  "/chat",
  "/words",
  "/level-up",
  "/kana",
  "/account",
];

// 경로 세그먼트 기준으로 판정한다. /chat/abc는 보호 페이지이고 /chatty는 아니다
export function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}
