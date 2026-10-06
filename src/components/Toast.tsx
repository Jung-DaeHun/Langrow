"use client";

import { useEffect, useState } from "react";

// (app) 레이아웃에 ToastHost를 한 번 두고 어디서든 showToast로 띄운다.
// 호스트가 상태를 가지므로 부른 컴포넌트가 곧바로 사라져도 토스트는 남는다. 짧은 성공 확인에만 쓴다

const DURATION_MS = 2400;

let show: ((message: string) => void) | null = null;

export function showToast(message: string): void {
  show?.(message);
}

export function ToastHost() {
  // 같은 문구를 다시 띄워도 타이머를 새로 시작하도록 매번 새 객체로 둔다
  const [toast, setToast] = useState<{ message: string } | null>(null);

  useEffect(() => {
    show = (message) => setToast({ message });
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // 알림이 읽히도록 live region은 항상 두고 내용만 바꾼다
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      {toast && (
        <p className="rounded-full bg-house px-4.5 py-2.5 text-sm font-semibold text-white shadow-overlay">
          {toast.message}
        </p>
      )}
    </div>
  );
}
