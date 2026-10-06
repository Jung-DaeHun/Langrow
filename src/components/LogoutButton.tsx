"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { getBrowserSupabase } from "@/services/supabase/browser";

// 브라우저가 Supabase를 쓰는 두 곳 중 하나(다른 하나는 GoogleLoginButton).
// 로그인 상태로 읽은 화면·라우터 캐시를 버리도록 성공하면 전체를 다시 불러온다

const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-accent bg-transparent px-5 font-semibold text-accent transition duration-200 hover:bg-black/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await getBrowserSupabase().auth.signOut();
      if (!error) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/");
        return;
      }
    } catch {
      // 네트워크 오류도 아래 오류 안내로 보여 준다
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" onClick={logout} disabled={busy} className={OUTLINE}>
          로그아웃
        </button>
      </div>
      {failed && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
          <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
          <p className="text-sm">로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.</p>
        </div>
      )}
    </div>
  );
}
