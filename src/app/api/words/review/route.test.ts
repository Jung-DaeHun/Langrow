import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { BATCH_MAX } from "@/lib/wordBatch";
import { createFakeDeps } from "@/test/fakes";
import { POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ word_id: `en-1-${String(i + 1).padStart(3, "0")}`, knew: true }));
const VALID = { language: "en", items: items(2) };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/words/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

async function read(response: Response) {
  return { status: response.status, json: await response.json() };
}

function errorBody(code: ErrorCode) {
  return { code, message: ERRORS[code].message };
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

describe("POST /api/words/review", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post(VALID))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.saveReview).not.toHaveBeenCalled();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 저장하지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post(VALID))).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.saveReview).not.toHaveBeenCalled();
  });

  it.each([
    ["회차 0개", { language: "en", items: [] }],
    ["회차 11개", { language: "en", items: items(BATCH_MAX + 1) }],
    ["중복 word_id", { language: "en", items: [...items(2), items(1)[0]] }],
    ["knew 누락", { language: "en", items: [{ word_id: "en-1-001" }] }],
    ["knew 문자열", { language: "en", items: [{ word_id: "en-1-001", knew: "false" }] }],
    ["빈 word_id", { language: "en", items: [{ word_id: "", knew: true }] }],
    ["너무 긴 word_id", { language: "en", items: [{ word_id: "x".repeat(51), knew: true }] }],
    ["없는 언어", { ...VALID, language: "fr" }],
  ])("%s는 400이고 저장하지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.saveReview).not.toHaveBeenCalled();
  });

  it("로그인 사용자 ID와 { wordId, knew }로 저장하고 reviewedCount를 돌려준다. body의 userId는 쓰지 않는다", async () => {
    deps.db.saveReview.mockResolvedValue({ ok: true, value: { reviewedCount: 1 } });

    const response = await post({
      userId: "99999999-9999-4999-8999-999999999999",
      language: "ja",
      items: [
        { word_id: "ja-1-001", knew: true },
        { word_id: "ja-1-002", knew: false },
      ],
    });

    expect(await read(response)).toEqual({ status: 200, json: { reviewedCount: 1 } });
    expect(deps.db.saveReview).toHaveBeenCalledWith(USER_ID, "ja", [
      { wordId: "ja-1-001", knew: true },
      { wordId: "ja-1-002", knew: false },
    ]);
  });

  it("회차 10개는 받는다", async () => {
    expect((await post({ language: "en", items: items(BATCH_MAX) })).status).toBe(200);
  });

  it("학습 기록이 없거나 다른 언어의 단어(INVALID_INPUT)면 400이다", async () => {
    deps.db.saveReview.mockResolvedValue({ ok: false, code: "INVALID_INPUT" });

    expect(await read(await post(VALID))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
  });
});
