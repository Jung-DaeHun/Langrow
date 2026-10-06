"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// jsdom에 <dialog>.showModal()이 없어서 포커스 가두기·Esc·포커스 복귀를 직접 구현한다.
// 상단바 같은 쌓임 맥락에 갇히지 않게 body에 포털로 그린다

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  variant: "modal" | "sheet";
  children: ReactNode;
};

export function Dialog({ open, onClose, title, variant, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const panel = panelRef.current;
    if (e.key !== "Tab" || panel === null) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = panel.contains(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  const sheet = variant === "sheet";
  return createPortal(
    <div className={`fixed inset-0 z-50 flex justify-center ${sheet ? "items-end" : "items-center p-4"}`}>
      {/* 배경 탭으로 닫기. 키보드는 Esc로 닫으므로 탭 순서와 접근성 트리에서 뺀다 */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          sheet
            ? "relative w-full max-w-[560px] rounded-t-xl bg-card px-5 pt-5 pb-7 animate-sheet"
            : "relative w-full max-w-[500px] rounded-xl bg-card p-6 shadow-overlay"
        }
      >
        {sheet ? (
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lead font-bold">
              {title}
            </h2>
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <h2 id={titleId} className="pr-12 text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">
              {title}
            </h2>
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className={`absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-black/5 text-ink ${FOCUS_RING}`}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
