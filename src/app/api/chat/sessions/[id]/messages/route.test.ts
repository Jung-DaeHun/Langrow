import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { maxDuration, POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const REPLY = {
  reply: "Nice to meet you, Minji! Where are you from?",
  reply_ko: "만나서 반가워요, 민지! 어디에서 왔어요?",
  correction: null,
};

function post(body: unknown, id = SESSION_ID) {
  return POST(
    new Request(`http://localhost/api/chat/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function read(response: Response) {
  return { status: response.status, json: await response.json() };
}

function errorBody(code: ErrorCode) {
  return { code, message: ERRORS[code].message };
}

function expectNoChatWork() {
  expect(deps.db.beginChatTurn).not.toHaveBeenCalled();
  expect(deps.ai.generateTurn).not.toHaveBeenCalled();
  expect(deps.db.finishChatTurn).not.toHaveBeenCalled();
  expect(deps.db.failChatTurn).not.toHaveBeenCalled();
}

beforeEach(() => {
  deps = createFakeDeps();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/chat/sessions/[id]/messages", () => {
  it("maxDuration은 60초다", () => {
    expect(maxDuration).toBe(60);
  });

  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post({ text: "hi" }))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expectNoChatWork();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 예약·AI를 부르지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post({ text: "hi" }))).toEqual({ status: 403, json: errorBody(code) });
    expectNoChatWork();
  });

  it.each([
    ["text 누락", {}],
    ["빈 문자열", { text: "" }],
    ["공백만", { text: "   \n " }],
    ["301자", { text: "a".repeat(301) }],
    ["문자열이 아닌 text", { text: 1 }],
  ])("%s는 400이고 예약·AI를 부르지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expectNoChatWork();
  });

  it("앞뒤 공백을 빼고 300자면 통과한다", async () => {
    const response = await post({ text: ` ${"a".repeat(300)} ` });

    expect(response.status).toBe(200);
    expect(deps.db.beginChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, "a".repeat(300));
  });

  it("uuid가 아닌 id는 404다", async () => {
    expect(await read(await post({ text: "hi" }, "not-a-uuid"))).toEqual({ status: 404, json: errorBody("NOT_FOUND") });
    expectNoChatWork();
  });

  it("로그인 사용자 ID·경로 id·body text로 턴을 처리하고, body의 userId는 쓰지 않는다", async () => {
    deps.db.finishChatTurn.mockResolvedValue({ ok: true, value: { turnsLeft: 19 } });
    deps.ai.generateTurn.mockResolvedValue({ ok: true, value: REPLY });

    const response = await post({ text: "Hi, I'm Minji.", userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: { turnNo: 1, turnsLeft: 19, reply: REPLY } });
    expect(deps.db.beginChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, "Hi, I'm Minji.");
    expect(deps.db.finishChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, expect.any(String), REPLY);
  });

  it("AI가 실패하면 503 AI_UNAVAILABLE이다", async () => {
    deps.ai.generateTurn.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await read(await post({ text: "hi" }))).toEqual({ status: 503, json: errorBody("AI_UNAVAILABLE") });
  });

  it("예약이 LIMIT_REACHED면 429다", async () => {
    deps.db.beginChatTurn.mockResolvedValue({ ok: false, code: "LIMIT_REACHED" });

    expect(await read(await post({ text: "hi" }))).toEqual({ status: 429, json: errorBody("LIMIT_REACHED") });
    expect(deps.ai.generateTurn).not.toHaveBeenCalled();
  });
});
