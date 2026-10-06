import type { ErrorCode } from "@/lib/errors";
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
