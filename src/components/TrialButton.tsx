"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/services/apiClient";
import type { TrialResponse } from "@/types/api";
import { showToast } from "./Toast";

// 7일 무료 체험 시작. 한도 안내와 계정 화면이 같이 쓴다. 체험 가능 여부는 서버가 판정한다(이미 사용했으면 409)

const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
// outline: 화면의 primary가 따로 있는 곳(AI 설명 한도 안내 — 회차의 primary는 [다음 문제])
const TONES = {
  primary: "bg-accent text-white hover:bg-brand",
  outline: "border border-accent bg-transparent text-accent hover:bg-black/5",
};
const SIZES = { sm: "h-9 px-4 text-sm", lg: "h-11 px-5" };

type Props = {
  label: string;
  size: "sm" | "lg";
  tone?: keyof typeof TONES;
  fullWidth?: boolean;
  onStarted?: () => void;
};

export function TrialButton({ label, size, tone = "primary", fullWidth = false, onStarted }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await api<TrialResponse>("POST", "/api/trial");
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // 버튼이 곧바로 사라져도 토스트는 셸의 ToastHost에 남는다
    showToast("7일 Pro 체험을 시작했어요");
    router.refresh();
    onStarted?.();
  }

  return (
    <div className={`flex flex-col gap-2 ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`${BUTTON} ${TONES[tone]} ${SIZES[size]} ${fullWidth ? "w-full" : ""}`}
      >
        {busy ? "시작하는 중…" : label}
      </button>
      {error !== null && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 text-ink ring-1 ring-danger ring-inset">
          <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
