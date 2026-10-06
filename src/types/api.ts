import type { ErrorCode } from "@/lib/errors";

// /api/** 실패 응답 body. API별 성공 응답 타입도 이 파일에 둔다 (브라우저 코드가 import한다)
export type ApiError = { code: ErrorCode; message: string };
