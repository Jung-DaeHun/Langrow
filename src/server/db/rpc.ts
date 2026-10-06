import "server-only";
import { getAdminSupabase } from "@/services/supabase/admin";
import type { Database } from "@/types/database";
import type { DbErrorCode, DbResult } from "./types";

type Functions = Database["public"]["Functions"];
export type RpcName = keyof Functions;

// 성공 응답에서 ok를 뺀 나머지 (snake_case 그대로)
export type RpcValue = Record<string, unknown>;

const DB_ERROR_CODES: readonly DbErrorCode[] = [
  "CONSENT_REQUIRED",
  "ONBOARDING_REQUIRED",
  "INVALID_INPUT",
  "NOT_FOUND",
  "LIMIT_REACHED",
  "AI_FAILURE_LIMIT",
  "SESSION_FULL",
  "CONFLICT",
];

function isDbErrorCode(x: unknown): x is DbErrorCode {
  return (DB_ERROR_CODES as readonly unknown[]).includes(x);
}

// RPC의 jsonb 응답 {"ok": true, ...} / {"ok": false, "code": ...}를 DbResult로 바꾼다.
// 형식이 다르거나 DB가 돌려줄 수 없는 code면 버그이므로 throw한다
export function toDbResult(fn: string, data: unknown): DbResult<RpcValue> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`RPC ${fn}: jsonb 객체 응답이 아닙니다`);
  }
  const { ok, ...rest } = data as Record<string, unknown>;
  if (ok === true) return { ok: true, value: rest };
  if (ok === false && isDbErrorCode(rest.code)) return { ok: false, code: rest.code };
  throw new Error(`RPC ${fn}: 알 수 없는 응답입니다 (ok=${String(ok)}, code=${String(rest.code)})`);
}

// admin 클라이언트로 RPC를 부른다. 예상하지 못한 SQL 오류는 throw한다.
// 에러 메시지에는 인자·행 내용(details)을 넣지 않는다 (대화 내용이 로그에 남지 않게)
export async function callRpc<F extends RpcName>(fn: F, args: Functions[F]["Args"]): Promise<DbResult<RpcValue>> {
  const { data, error } = await getAdminSupabase().rpc(fn, args);
  if (error) throw new Error(`RPC ${fn} 실패: ${error.code} ${error.message}`);
  return toDbResult(fn, data);
}
