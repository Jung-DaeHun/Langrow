"use client";

import { Check, ChevronDown, CircleAlert, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LANGUAGE_NAMES, LANGUAGES, LEVEL_INFO, type Language, type Level } from "@/lib/levels";
import { api } from "@/services/apiClient";
import type { LevelResponse } from "@/types/api";
import { Dialog } from "./Dialog";
import { showToast } from "./Toast";

// 상단바의 언어·레벨 메뉴. 레벨이 있는 언어로 전환하고, 새 언어는 온보딩 레벨 단계로 보내고, 레벨을 내린다

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const TILE = `flex w-full items-center gap-3.5 rounded-xl p-4 text-left shadow-card transition disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const TILE_IDLE = "bg-card hover:ring-1 hover:ring-line-input";
const TILE_SELECTED = "bg-ok-wash ring-2 ring-accent";
const BUTTON = `inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const OUTLINE = `${BUTTON} border border-accent bg-transparent text-accent hover:bg-black/5`;
const PRIMARY = `${BUTTON} bg-accent text-white hover:bg-brand`;
const ERROR_NOTICE = "flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-inset ring-danger";

type Props = { language: Language; levels: Partial<Record<Language, Level>> };

export function LanguageSheet({ language, levels }: Props) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const level = levels[language];

  function openSheet() {
    setSheetError(null);
    setSheetOpen(true);
  }

  function openConfirm() {
    setSheetOpen(false);
    setConfirmError(null);
    setConfirmOpen(true);
  }

  async function switchTo(target: Language) {
    setBusy(true);
    setSheetError(null);
    const result = await api("PUT", "/api/me/language", { language: target });
    setBusy(false);
    if (!result.ok) {
      setSheetError(result.message);
      return;
    }
    setSheetOpen(false);
    router.refresh();
  }

  async function lower(from: Level) {
    setBusy(true);
    setConfirmError(null);
    const result = await api<LevelResponse>("PATCH", `/api/levels/${language}`, { level: from - 1 });
    setBusy(false);
    if (!result.ok) {
      setConfirmError(result.message);
      return;
    }
    setConfirmOpen(false);
    showToast("레벨을 내렸어요");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={openSheet}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`}
      >
        {LANGUAGE_NAMES[language]}
        {level !== undefined && ` · ${LEVEL_INFO[level].name}`}
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="학습 언어" variant="sheet">
        <div role="radiogroup" aria-label="학습 언어" className="mt-4 flex flex-col gap-2">
          {LANGUAGES.map((lang) => {
            const current = lang === language;
            const lv = levels[lang];
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={`grid size-9 shrink-0 place-items-center rounded-full font-bold ${current ? "bg-accent text-white" : "bg-zone"}`}
                >
                  {lang.toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold">{LANGUAGE_NAMES[lang]}</span>
                  <span className="text-sm text-ink-muted">
                    {lv === undefined ? "새 언어 추가하기" : `레벨 ${lv} · ${LEVEL_INFO[lv].name}`}
                  </span>
                </span>
                {current && <Check size={20} aria-hidden="true" className="shrink-0 text-accent" />}
                {lv === undefined && <Plus size={20} aria-hidden="true" className="shrink-0 text-accent" />}
              </>
            );
            if (lv === undefined) {
              return (
                <Link
                  key={lang}
                  href={`/onboarding?language=${lang}`}
                  role="radio"
                  aria-checked="false"
                  className={`${TILE} ${TILE_IDLE}`}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={lang}
                type="button"
                role="radio"
                aria-checked={current}
                disabled={busy && !current}
                onClick={current ? undefined : () => switchTo(lang)}
                className={`${TILE} ${current ? TILE_SELECTED : TILE_IDLE}`}
              >
                {content}
              </button>
            );
          })}
        </div>
        {sheetError !== null && (
          <div role="alert" className={`mt-4 ${ERROR_NOTICE}`}>
            <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
            <p className="text-sm">{sheetError}</p>
          </div>
        )}
        {level !== undefined && level >= 2 && (
          <button type="button" onClick={openConfirm} disabled={busy} className={`mt-4 w-full ${OUTLINE}`}>
            레벨 내리기 ({LEVEL_INFO[level].name} → {LEVEL_INFO[(level - 1) as Level].name})
          </button>
        )}
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="레벨을 내릴까요?" variant="modal">
        <p className="mt-2 text-ink-muted">다시 올리려면 레벨업 테스트를 통과해야 해요.</p>
        {confirmError !== null && (
          <div role="alert" className={`mt-4 ${ERROR_NOTICE}`}>
            <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
            <p className="text-sm">{confirmError}</p>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOpen(false)} className={OUTLINE}>
            취소
          </button>
          {level !== undefined && (
            <button type="button" onClick={() => lower(level)} disabled={busy} className={PRIMARY}>
              내리기
            </button>
          )}
        </div>
      </Dialog>
    </>
  );
}
