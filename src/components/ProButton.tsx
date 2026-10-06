"use client";

import { useState } from "react";
import { api } from "@/services/apiClient";
import { Dialog } from "./Dialog";

// 결제가 없으므로 누르면 "정식 출시 준비 중"을 보여 준다. 누를 때마다 pro_clicked를 한 번 기록한다(spec 5장)

const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent font-semibold text-white transition duration-200 hover:bg-brand active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const SIZES = { sm: "h-9 px-4 text-sm", lg: "h-11 px-5" };

type Props = { label: string; size: "sm" | "lg"; fullWidth?: boolean };

export function ProButton({ label, size, fullWidth = false }: Props) {
  const [open, setOpen] = useState(false);

  function click() {
    // 지표 기록이다. 결과를 기다리지 않고, 실패해도 모달은 연다
    void api("POST", "/api/events", { name: "pro_clicked" });
    setOpen(true);
  }

  return (
    <>
      <button type="button" onClick={click} className={`${BUTTON} ${SIZES[size]} ${fullWidth ? "w-full" : ""}`}>
        {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="정식 출시 준비 중" variant="modal">
        <p className="mt-2 text-ink-muted">Pro는 정식 출시를 준비하고 있어요. 결제 정보는 받지 않아요.</p>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} className={`${BUTTON} ${SIZES.lg}`}>
            확인
          </button>
        </div>
      </Dialog>
    </>
  );
}
