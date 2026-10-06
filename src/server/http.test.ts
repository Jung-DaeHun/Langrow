import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import type { Requirement } from "@/lib/readiness";
import { createFakeDeps } from "@/test/fakes";
import { getDeps } from "./deps";
import { route, type Outcome } from "./http";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const URL_WITH_QUERY = "http://localhost/api/chat/sessions/x/messages?memo=query-secret";

type Ctx = { userId: string; params: { id: string }; body: { text: string } };
const handler = vi.fn(async (ctx: Ctx): Promise<Outcome<unknown>> => ({ ok: true, value: { received: ctx } }));

// 경로 파라미터와 body가 모두 있는 route (대화 전송과 같은 모양)
function messageRoute(requirement: Requirement = "ready") {
  return route({
    requirement,
    params: z.object({ id: z.uuid() }),
    body: z.object({ text: z.string().min(1).max(300) }),
    handler,
  });
}

// 경로 파라미터와 body가 없는 route
function plainRoute(requirement: Requirement, outcome: () => Promise<Outcome<unknown>>) {
  return route({ requirement, handler: outcome });
}

function request(init: { body?: string; contentType?: string | null; cookie?: string } = {}) {
  const headers = new Headers();
  const contentType = init.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(URL_WITH_QUERY, { method: "POST", headers, body: init.body });
}

function context(params: unknown = { id: SESSION_ID }) {
  return { params: Promise.resolve(params) };
}

const validBody = JSON.stringify({ text: "Hi, I'm Minji." });

async function read(response: Response) {
  return { status: response.status, json: await response.json() };
}

function errorBody(code: ErrorCode) {
  return { code, message: ERRORS[code].message };
}

// console.warn·console.error로 남긴 로그 줄
function logLines(): string[] {
  return [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls].map((args) => args.join(" "));
}

beforeEach(() => {
  deps = createFakeDeps();
  handler.mockClear();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("route() 로그인", () => {
  it("사용자가 없으면 401이고 body와 준비 상태를 읽지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = request({ body: validBody });

    expect(await read(await messageRoute()(req, context()))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(req.bodyUsed).toBe(false);
    expect(deps.db.getReadiness).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("getUser가 에러를 돌려주면 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });

    const { status } = await read(await messageRoute()(request({ body: validBody }), context()));
    expect(status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("route() Content-Type", () => {
  it("Content-Type이 없으면 400이다", async () => {
    const res = await plainRoute("login", async () => ({ ok: true, value: null }))(
      request({ contentType: null }),
      context(),
    );
    expect(await read(res)).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp"])(
    "%s는 400이다",
    async (contentType) => {
      const res = await messageRoute()(request({ body: validBody, contentType }), context());
      expect(await read(res)).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each(["application/json; charset=utf-8", "Application/JSON", "application/json;charset=UTF-8"])(
    "%s는 통과한다",
    async (contentType) => {
      const res = await messageRoute()(request({ body: validBody, contentType }), context());
      expect(res.status).toBe(200);
    },
  );

  it("body가 없는 API도 JSON Content-Type을 요구하고, body는 읽지 않는다", async () => {
    const outcome = vi.fn(async (): Promise<Outcome<unknown>> => ({ ok: true, value: null }));
    const consent = plainRoute("login", outcome);

    expect((await consent(request({ contentType: "text/plain" }), context())).status).toBe(400);
    expect(outcome).not.toHaveBeenCalled();

    const req = request({ body: "not json" });
    expect((await consent(req, context())).status).toBe(200);
    expect(req.bodyUsed).toBe(false);
  });
});

describe("route() 경로 파라미터와 body", () => {
  it("params 검증에 실패하면 404이고 준비 상태와 handler를 건너뛴다", async () => {
    const res = await messageRoute()(request({ body: validBody }), context({ id: "not-a-uuid" }));

    expect(await read(res)).toEqual({ status: 404, json: errorBody("NOT_FOUND") });
    expect(deps.db.getReadiness).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("깨진 JSON은 400이다", async () => {
    const res = await messageRoute()(request({ body: '{"text":' }), context());
    expect(await read(res)).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([JSON.stringify({ text: "" }), JSON.stringify({ text: 123 }), JSON.stringify({}), "null"])(
    "zod 검증에 실패한 body %s는 400이다",
    async (body) => {
      const res = await messageRoute()(request({ body }), context());
      expect(await read(res)).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
      expect(deps.db.getReadiness).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("handler는 getUser의 userId와 검증된 params·body를 받고, body의 userId는 무시한다", async () => {
    const body = JSON.stringify({ text: "Hi", userId: "33333333-3333-4333-8333-333333333333" });

    const res = await messageRoute()(request({ body }), context());

    expect(res.status).toBe(200);
    expect(deps.db.getReadiness).toHaveBeenCalledWith(USER_ID);
    expect(handler).toHaveBeenCalledWith({ userId: USER_ID, params: { id: SESSION_ID }, body: { text: "Hi" } });
  });
});

describe("route() 준비 상태", () => {
  it("미동의면 403 CONSENT_REQUIRED이고 handler를 부르지 않는다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: null, currentLanguage: null, levels: {} });

    const res = await messageRoute()(request({ body: validBody }), context());

    expect(await read(res)).toEqual({ status: 403, json: errorBody("CONSENT_REQUIRED") });
    expect(handler).not.toHaveBeenCalled();
  });

  it("현재 언어의 레벨이 없으면 403 ONBOARDING_REQUIRED이고 handler를 부르지 않는다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: new Date(), currentLanguage: "ja", levels: { en: 2 } });

    const res = await messageRoute()(request({ body: validBody }), context());

    expect(await read(res)).toEqual({ status: 403, json: errorBody("ONBOARDING_REQUIRED") });
    expect(handler).not.toHaveBeenCalled();
  });

  it("'login'은 미동의 사용자도 통과하고 준비 상태를 읽지 않는다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: null, currentLanguage: null, levels: {} });

    const res = await messageRoute("login")(request({ body: validBody }), context());

    expect(res.status).toBe(200);
    expect(deps.db.getReadiness).not.toHaveBeenCalled();
  });

  it("'consent'는 레벨이 없어도 통과한다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: new Date(), currentLanguage: null, levels: {} });

    expect((await messageRoute("consent")(request({ body: validBody }), context())).status).toBe(200);
  });

  it("'consent'도 미동의면 403 CONSENT_REQUIRED다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: null, currentLanguage: null, levels: {} });

    const res = await messageRoute("consent")(request({ body: validBody }), context());

    expect(await read(res)).toEqual({ status: 403, json: errorBody("CONSENT_REQUIRED") });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("route() 응답 변환", () => {
  it("성공은 200과 value다", async () => {
    const res = await plainRoute("ready", async () => ({ ok: true, value: { sessionId: SESSION_ID } }))(
      request(),
      context(),
    );
    expect(await read(res)).toEqual({ status: 200, json: { sessionId: SESSION_ID } });
  });

  it("value가 null이면 {}다", async () => {
    const res = await plainRoute("ready", async () => ({ ok: true, value: null }))(request(), context());
    expect(await read(res)).toEqual({ status: 200, json: {} });
  });

  it("status 202는 에러가 아니라 202 응답이다", async () => {
    const res = await plainRoute("ready", async () => ({ ok: true, value: { state: "ending" }, status: 202 }))(
      request(),
      context(),
    );
    expect(await read(res)).toEqual({ status: 202, json: { state: "ending" } });
  });

  it.each(Object.keys(ERRORS) as ErrorCode[])("에러 코드 %s는 ERRORS의 상태와 { code, message }다", async (code) => {
    const res = await plainRoute("ready", async () => ({ ok: false, code }))(request(), context());
    expect(await read(res)).toEqual({ status: ERRORS[code].status, json: errorBody(code) });
  });

  it("server/db의 DbResult를 그대로 반환할 수 있다", async () => {
    deps.db.switchLanguage.mockResolvedValue({ ok: false, code: "CONFLICT" });
    const language = route({
      requirement: "consent",
      body: z.object({ language: z.enum(["en", "ja"]) }),
      handler: ({ userId, body }) => getDeps().db.switchLanguage(userId, body.language),
    });

    const res = await language(request({ body: JSON.stringify({ language: "ja" }) }), context());

    expect(await read(res)).toEqual({ status: 409, json: errorBody("CONFLICT") });
    expect(deps.db.switchLanguage).toHaveBeenCalledWith(USER_ID, "ja");
  });

  it("동적 세그먼트가 있는 Next route handler 타입에 맞는다", async () => {
    // next build가 route.ts의 export를 검사하는 타입과 같은 모양
    const POST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response | void> =
      messageRoute();

    const res = await POST(
      new NextRequest(URL_WITH_QUERY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: validBody,
      }),
      { params: Promise.resolve({ id: SESSION_ID }) },
    );
    expect(res?.status).toBe(200);
  });
});

describe("route() 예외", () => {
  it("handler가 throw하면 500 INTERNAL이다", async () => {
    handler.mockRejectedValueOnce(new Error("RPC begin_chat_turn 실패"));
    const res = await messageRoute()(request({ body: validBody }), context());
    expect(await read(res)).toEqual({ status: 500, json: errorBody("INTERNAL") });
  });

  it("getUser가 throw하면 500 INTERNAL이다", async () => {
    getUser.mockRejectedValue(new Error("fetch failed"));
    const res = await messageRoute()(request({ body: validBody }), context());
    expect(await read(res)).toEqual({ status: 500, json: errorBody("INTERNAL") });
    expect(handler).not.toHaveBeenCalled();
  });

  it("getReadiness가 throw하면 500 INTERNAL이다", async () => {
    deps.db.getReadiness.mockRejectedValue(new Error("profiles 조회 실패"));
    const res = await messageRoute()(request({ body: validBody }), context());
    expect(await read(res)).toEqual({ status: 500, json: errorBody("INTERNAL") });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("route() 로그", () => {
  it("실패 응답은 code·userId·method·경로·처리 시간만 한 줄 남긴다", async () => {
    const body = JSON.stringify({ text: 123, memo: "body-secret 대화 내용" });

    await messageRoute()(request({ body, cookie: "sb-token=cookie-secret" }), context());

    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      code: "INVALID_INPUT",
      userId: USER_ID,
      method: "POST",
      path: "/api/chat/sessions/x/messages",
      ms: expect.any(Number),
    });
    for (const secret of ["body-secret", "대화 내용", "cookie-secret", "query-secret"]) {
      expect(lines[0]).not.toContain(secret);
    }
  });

  it("로그인 전 실패는 userId가 null이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await messageRoute()(request({ body: validBody }), context());

    expect(JSON.parse(logLines()[0])).toMatchObject({ code: "UNAUTHORIZED", userId: null });
  });

  it("INTERNAL은 console.error로 남기고 예외 message를 덧붙인다", async () => {
    handler.mockRejectedValueOnce(new Error("RPC begin_chat_turn 실패: 42P01"));

    await messageRoute()(request({ body: validBody }), context());

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logLines()[0])).toEqual({
      code: "INTERNAL",
      userId: USER_ID,
      method: "POST",
      path: "/api/chat/sessions/x/messages",
      ms: expect.any(Number),
      error: "RPC begin_chat_turn 실패: 42P01",
    });
  });

  it.each([
    ["200", { ok: true, value: null }],
    ["202", { ok: true, value: { state: "ending" }, status: 202 }],
  ] as const)("성공 응답(%s)은 로그를 남기지 않는다", async (_label, outcome) => {
    await plainRoute("ready", async () => outcome)(request(), context());

    for (const method of ["warn", "error", "log", "info"] as const) {
      expect(console[method]).not.toHaveBeenCalled();
    }
  });
});
