"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// 약관 페이지의 [돌아가기]. 내 정보·랜딩에서 왔으면 그 화면으로 돌아가고,
// 앞 기록이 없으면(온보딩에서 새 탭으로 열었거나 주소로 바로 들어옴) 랜딩으로 간다.
// Ctrl·Cmd·Shift 클릭은 새 탭·새 창으로 여는 링크 기본 동작에 맡긴다
export function BackButton() {
  const router = useRouter();

  return (
    <Link
      href="/"
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (window.history.length > 1) {
          event.preventDefault();
          router.back();
        }
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <ChevronLeft size={16} aria-hidden="true" />
      돌아가기
    </Link>
  );
}
