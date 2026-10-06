import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatRoom } from "@/components/ChatRoom";
import { trialState } from "@/lib/plan";
import { findScenario } from "@/lib/scenarios";
import { readChatRoom } from "@/server/db/reads";
import { requireReady } from "@/server/page";

export const metadata: Metadata = { title: "대화 · Langrow" };

// 대화방. 세션의 언어·레벨은 현재 학습 언어가 아니라 세션에 저장된 값을 쓴다. 남의·없는 세션은 404다

export default async function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId, account, now } = await requireReady();
  const room = await readChatRoom(supabase, userId, id);
  if (room === null) notFound();

  const scenario = findScenario(room.scenarioId);
  // 저장된 세션의 상황이 상수에 없으면 상황 상수에서 항목이 빠진 버그다
  if (scenario === undefined) throw new Error(`상황이 없습니다 (${room.scenarioId})`);
  const trial = trialState(account.trialStartedAt, account.proUntil, now);

  return (
    <ChatRoom
      key={room.id}
      room={room}
      scenario={{ title: scenario.title, opening: scenario.roles[room.language].opening }}
      trial={trial}
    />
  );
}
