import "server-only";
import type { z } from "zod";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { checkReadiness, type Requirement } from "@/lib/readiness";
import { getServerSupabase } from "@/services/supabase/server";
import type { ApiError } from "@/types/api";
import { getDeps } from "./deps";

// handler 결과. server/db의 DbResult<T>도 그대로 Outcome<T>다. 202는 /end 처리 중 응답이다.
// message는 같은 code인데 문구가 다른 API(AI 설명 503)만 넣는다. 없으면 ERRORS의 문구다
export type Outcome<T> = { ok: true; value: T; status?: 202 } | { ok: false; code: ErrorCode; message?: string };

type Spec<B, P> = {
  requirement: Requirement; // 'login' | 'consent' | 'ready'
  params?: z.ZodType<P>; // 경로 파라미터. 없으면 읽지 않는다
  body?: z.ZodType<B>; // 요청 body. 없으면 읽지 않는다
  handler: (ctx: { userId: string; params: P; body: B }) => Promise<Outcome<unknown>>;
};

// next build가 검사하는 route handler 모양: (request, { params: Promise<…> })
type RouteHandler = (request: Request, context: { params: Promise<unknown> }) => Promise<Response>;

// CSRF 방어: body가 없는 API도 JSON Content-Type만 받는다. 파라미터(charset)와 대소문자는 허용한다
function isJson(contentType: string | null): boolean {
  return contentType?.split(";")[0].trim().toLowerCase() === "application/json";
}

function toResponse(outcome: Outcome<unknown>): Response {
  if (outcome.ok) return Response.json(outcome.value ?? {}, { status: outcome.status ?? 200 });
  const { status, message } = ERRORS[outcome.code];
  return Response.json({ code: outcome.code, message: outcome.message ?? message } satisfies ApiError, { status });
}

// 로그인(401) → Content-Type(400) → params(404) → body(400) → 준비 상태(403) → handler 순서다.
// 앞 단계에서 실패하면 뒤 단계를 하지 않는다. 예외는 모두 500 INTERNAL이다
export function route<B = undefined, P = undefined>(spec: Spec<B, P>): RouteHandler {
  return async (request, context) => {
    const startedAt = Date.now();
    let userId: string | null = null;

    async function run(): Promise<Outcome<unknown>> {
      const { data, error } = await (await getServerSupabase()).auth.getUser();
      if (error || !data.user) return { ok: false, code: "UNAUTHORIZED" };
      userId = data.user.id;

      if (!isJson(request.headers.get("content-type"))) return { ok: false, code: "INVALID_INPUT" };

      let params = undefined as P;
      if (spec.params) {
        const parsed = spec.params.safeParse(await context.params);
        if (!parsed.success) return { ok: false, code: "NOT_FOUND" };
        params = parsed.data;
      }

      let body = undefined as B;
      if (spec.body) {
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return { ok: false, code: "INVALID_INPUT" };
        }
        const parsed = spec.body.safeParse(json);
        if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
        body = parsed.data;
      }

      // 요청·세션 언어의 레벨은 RPC가 잠근 뒤 다시 확인한다
      if (spec.requirement !== "login") {
        const readiness = checkReadiness(await getDeps().db.getReadiness(userId), spec.requirement);
        if (readiness !== "ok") return { ok: false, code: readiness };
      }

      return spec.handler({ userId, params, body });
    }

    let outcome: Outcome<unknown>;
    let thrown: unknown;
    try {
      outcome = await run();
    } catch (error) {
      thrown = error;
      outcome = { ok: false, code: "INTERNAL" };
    }

    const response = toResponse(outcome);
    if (!outcome.ok) {
      // 요청 body·쿠키·query·이메일·대화 내용은 남기지 않는다
      const line = JSON.stringify({
        code: outcome.code,
        userId,
        method: request.method,
        path: new URL(request.url).pathname,
        ms: Date.now() - startedAt,
        ...(outcome.code === "INTERNAL" && {
          error: thrown instanceof Error ? thrown.message : String(thrown),
        }),
      });
      if (response.status >= 500) console.error(line);
      else console.warn(line);
    }
    return response;
  };
}
