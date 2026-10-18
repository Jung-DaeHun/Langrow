"use client";

import { ChevronDown, ChevronRight, CircleAlert, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { Language, Level } from "@/lib/levels";
import type { ScenarioGroup, ScenarioTile } from "@/lib/scenarios";
import { api } from "@/services/apiClient";
import type { ChatSessionCreated } from "@/types/api";
import { Dialog } from "./Dialog";
import { useProComingSoon } from "./ProButton";
import { TrialButton } from "./TrialButton";

// 상황 목록. 레벨 묶음(입문 → 고수)으로 두고 처음에는 지금 레벨 묶음만 펼친다(spec/ui.md "상황 목록").
// 열린 세션이 있는 상황은 그 세션으로 가고, 위 레벨 상황과 Free의 Pro 상황은 모달로 안내하고, 나머지는 새 세션을 만든다(Claude 호출 없음).
// access는 표시용이고 잠금·Pro 판정은 세션 생성 API가 다시 한다. 레벨이 실제 레벨과 다르면 서버가 409를 주고, 화면을 다시 읽는다

type Access = "pro" | "trial-available" | "trial-ended";
type Props = { language: Language; level: Level; groups: ScenarioGroup[]; access: Access };

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const TILE = `flex w-full items-center gap-3.5 rounded-xl bg-card p-4 text-left shadow-card transition hover:ring-1 hover:ring-line-input disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 ${FOCUS_RING}`;
const HEADER = `flex min-h-11 w-full items-center gap-2 rounded-xl text-left ${FOCUS_RING}`;
const TAG = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold";
const BASIC_TAG = `${TAG} bg-mint text-brand`;
const GOLD_TAG = `${TAG} bg-gold-wash text-on-gold ring-1 ring-gold-light ring-inset`;
const BUTTON = `inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const OUTLINE = `${BUTTON} border border-accent bg-transparent text-accent hover:bg-black/5`;
const PRIMARY = `${BUTTON} bg-accent text-white hover:bg-brand`;

export function ScenarioPicker({ language, level, groups, access }: Props) {
  const router = useRouter();
  const comingSoon = useProComingSoon();
  const panelId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Level[]>([level]);
  const [modal, setModal] = useState<"locked" | "trial" | null>(null);

  function toggle(groupLevel: Level) {
    setExpanded((prev) => (prev.includes(groupLevel) ? prev.filter((l) => l !== groupLevel) : [...prev, groupLevel]));
  }

  // 열린 세션이 없는 타일만 부른다. 열린 세션은 Pro 상황이고 체험이 끝났어도 링크로 이어 간다
  function choose(item: ScenarioTile) {
    if (item.locked) {
      setModal("locked");
    } else if (item.pro && access === "trial-available") {
      setModal("trial");
    } else if (item.pro && access === "trial-ended") {
      comingSoon.show();
    } else {
      void start(item.scenarioId);
    }
  }

  async function start(scenarioId: string) {
    setBusy(true);
    setError(null);
    // 아래 레벨 상황도 세션 레벨은 지금 레벨이다(spec/chat.md "대화 진행")
    const result = await api<ChatSessionCreated>("POST", "/api/chat/sessions", { language, level, scenario_id: scenarioId });
    if (!result.ok) {
      setBusy(false);
      if (result.code === "PRO_REQUIRED") {
        // 화면을 연 뒤 체험이 끝났다. 목록을 다시 읽고 체험을 쓴 Free와 같은 안내를 띄운다
        router.refresh();
        comingSoon.show();
        return;
      }
      setError(result.message);
      if (result.code === "CONFLICT") router.refresh();
      return;
    }
    // 이동하는 동안 다른 타일로 세션을 또 만들지 못하게 비활성화를 유지한다
    router.push(`/chat/${result.data.sessionId}`);
  }

  function closeModal() {
    setModal(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
          <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
          <p className="text-sm">{error}</p>
        </div>
      )}
      {groups.map((group) => {
        const open = expanded.includes(group.level);
        const id = `${panelId}-${group.level}`;
        return (
          <div key={group.level} className="flex flex-col gap-3">
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => toggle(group.level)} className={HEADER}>
              <span className="font-bold">{group.name}</span>
              <span className="text-sm text-ink-muted">상황 {group.items.length}개</span>
              {group.level === level && <span className={BASIC_TAG}>지금 레벨</span>}
              {group.locked && (
                <>
                  <Lock size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
                  <span className="sr-only">잠김</span>
                </>
              )}
              <ChevronDown size={20} aria-hidden="true" className={`ml-auto shrink-0 text-ink-muted ${open ? "rotate-180" : ""}`} />
            </button>
            <ul id={id} hidden={!open} className="grid gap-4 md:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.scenarioId}>
                  {item.open === null ? (
                    <button type="button" disabled={busy} onClick={() => choose(item)} className={TILE}>
                      <TileBody item={item} access={access} />
                    </button>
                  ) : (
                    <Link
                      href={`/chat/${item.open.id}`}
                      aria-disabled={busy || undefined}
                      tabIndex={busy ? -1 : undefined}
                      className={TILE}
                    >
                      <TileBody item={item} access={access} />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <Dialog open={modal === "locked"} onClose={closeModal} title="레벨업 테스트에 합격하면 열려요" variant="modal">
        <p className="mt-2 text-ink-muted">지금 레벨보다 높은 상황이에요. 레벨업 테스트로 한 단계씩 올릴 수 있어요.</p>
        {/* 320px에서는 두 버튼이 한 줄에 들어가지 않아 줄을 바꾼다(버튼 글자가 꺾이지 않게) */}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={closeModal} className={OUTLINE}>
            닫기
          </button>
          <Link href="/level-up" className={PRIMARY}>
            레벨업 테스트 하기
          </Link>
        </div>
      </Dialog>

      <Dialog open={modal === "trial"} onClose={closeModal} title="Pro 상황이에요" variant="modal">
        <p className="mt-2 text-ink-muted">
          Pro는 레벨마다 상황 7개를 모두 할 수 있어요. 7일 무료 체험으로 써 보세요. 결제 정보는 받지 않아요.
        </p>
        <div className="mt-6 flex flex-wrap items-start justify-end gap-2">
          <button type="button" onClick={closeModal} className={OUTLINE}>
            닫기
          </button>
          {/* 토스트와 목록 다시 읽기는 TrialButton이 한다. 세션은 사용자가 타일을 다시 눌러 만든다 */}
          <TrialButton label="7일 무료 체험" size="lg" onStarted={closeModal} />
        </div>
      </Dialog>

      {comingSoon.dialog}
    </div>
  );
}

function statusTag(item: ScenarioTile): string | null {
  if (item.open !== null) return item.open.status === "active" ? `${item.open.doneTurns}턴 진행 중` : "피드백 확인";
  return item.completed ? "완료" : null;
}

function TileBody({ item, access }: { item: ScenarioTile; access: Access }) {
  const status = statusTag(item);
  const freePro = item.pro && access !== "pro";
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-micro text-ink-muted">상황 {item.index}</span>
          {status !== null && <span className={BASIC_TAG}>{status}</span>}
          {item.pro && (
            <span className={GOLD_TAG}>
              {freePro && <Lock size={12} aria-hidden="true" />}
              Pro
            </span>
          )}
          {item.locked && <Lock size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />}
          {/* 자물쇠가 둘(Free의 Pro 태그, 위 레벨)이어도 "잠김"은 한 번만 읽힌다 */}
          {(item.locked || freePro) && <span className="sr-only">잠김</span>}
        </span>
        <span className="text-lead font-bold">{item.title}</span>
        <span className="text-sm text-ink-muted">{item.goal}</span>
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
    </>
  );
}
