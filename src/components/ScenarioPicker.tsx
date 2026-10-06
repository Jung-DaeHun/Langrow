"use client";

import { ChevronRight, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Language, Level } from "@/lib/levels";
import { api } from "@/services/apiClient";
import type { ChatSessionCreated } from "@/types/api";

// 상황 목록 타일. 열린 세션이 있는 상황은 그 세션으로 가고, 나머지는 새 세션을 만든다(Claude 호출 없음).
// 레벨이 실제 레벨과 다르면 서버가 409를 주고, 화면을 다시 읽어 현재 레벨의 상황을 보여 준다

type Item = {
  scenarioId: string;
  index: number;
  title: string;
  goal: string;
  open: { id: string; status: "active" | "ending"; doneTurns: number } | null;
  completed: boolean;
};
type Props = { language: Language; level: Level; items: Item[] };

const TILE =
  "flex w-full items-center gap-3.5 rounded-xl bg-card p-4 text-left shadow-card transition hover:ring-1 hover:ring-line-input disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const TAG = "inline-flex items-center gap-1 rounded-full bg-mint px-2.5 py-0.5 text-xs font-bold text-brand";

export function ScenarioPicker({ language, level, items }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(scenarioId: string) {
    setBusy(true);
    setError(null);
    const result = await api<ChatSessionCreated>("POST", "/api/chat/sessions", { language, level, scenario_id: scenarioId });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      if (result.code === "CONFLICT") router.refresh();
      return;
    }
    // 이동하는 동안 다른 타일로 세션을 또 만들지 못하게 비활성화를 유지한다
    router.push(`/chat/${result.data.sessionId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
          <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
          <p className="text-sm">{error}</p>
        </div>
      )}
      <ul className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <li key={item.scenarioId}>
            {item.open === null ? (
              <button type="button" disabled={busy} onClick={() => start(item.scenarioId)} className={TILE}>
                <TileBody item={item} tag={item.completed ? "완료" : null} />
              </button>
            ) : (
              <Link
                href={`/chat/${item.open.id}`}
                aria-disabled={busy || undefined}
                tabIndex={busy ? -1 : undefined}
                className={TILE}
              >
                <TileBody
                  item={item}
                  tag={item.open.status === "active" ? `${item.open.doneTurns}턴 진행 중` : "피드백 확인"}
                />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TileBody({ item, tag }: { item: Item; tag: ReactNode }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-micro text-ink-muted">상황 {item.index}</span>
          {tag !== null && <span className={TAG}>{tag}</span>}
        </span>
        <span className="text-lead font-bold">{item.title}</span>
        <span className="text-sm text-ink-muted">{item.goal}</span>
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
    </>
  );
}
