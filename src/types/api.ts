import type { ErrorCode } from "@/lib/errors";
import type { Level } from "@/lib/levels";
import type { EndResult } from "@/server/db/chat";
import type { TurnReply } from "@/services/claude/schemas";

// /api/** 실패 응답 body. API별 성공 응답 타입도 이 파일에 둔다 (브라우저 코드가 import한다)
export type ApiError = { code: ErrorCode; message: string };

// POST /api/chat/sessions
export type ChatSessionCreated = { sessionId: string };

// POST /api/chat/sessions/[id]/messages. reply는 DB에 저장되는 형태 그대로다(reply_ko, correction.explanation_ko)
export type ChatMessageResponse = { turnNo: number; turnsLeft: number; reply: TurnReply };

// POST /api/chat/sessions/[id]/end. ended는 200, ending은 202다
export type ChatEndResponse =
  | ({ status: "ended" } & EndResult)
  | { status: "ending"; retryAfterSeconds: number };

// 동의(POST /api/me/consent), 언어 전환(PUT /api/me/language), 첫 레벨(POST /api/levels),
// 이벤트(POST /api/events)는 성공하면 {}다

// POST /api/words/batch. 기존 단어는 세지 않는다
export type WordBatchResponse = { insertedCount: number };

// POST /api/words/review
export type WordReviewResponse = { reviewedCount: number };

// POST /api/level-up. passed·level은 RPC 결과다. wrong은 틀린 순서대로이고 answer는 정답 표기다
export type LevelUpResponse = { passed: boolean; level: Level; score: number; wrong: { wordId: string; answer: string }[] };

// PATCH /api/levels/[language]
export type LevelResponse = { level: Level };

// POST /api/trial. ISO 문자열
export type TrialResponse = { proUntil: string };
