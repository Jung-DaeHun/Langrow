import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS } from "@/lib/errors";
import { api, NETWORK_MESSAGE } from "./apiClient";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { assign } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  assign.mockReset();
});

describe("api 요청", () => {
  it("body를 JSON으로 보내고 JSON Content-Type을 단다", async () => {
    fetchMock.mockResolvedValue(json(200, {}));

    await api("PUT", "/api/me/language", { language: "ja" });

    expect(fetchMock).toHaveBeenCalledWith("/api/me/language", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "ja" }),
    });
  });

  it("body가 없는 호출에도 Content-Type은 보내고 body는 보내지 않는다", async () => {
    fetchMock.mockResolvedValue(json(200, {}));

    await api("POST", "/api/trial");

    const init = fetchMock.mock.calls[0][1];
    expect(init).toEqual({ method: "POST", headers: { "content-type": "application/json" } });
    expect(init).not.toHaveProperty("body");
  });
});

describe("api 성공", () => {
  it("200이면 data를 돌려준다", async () => {
    fetchMock.mockResolvedValue(json(200, { level: 2 }));

    expect(await api("PATCH", "/api/levels/en", { level: 2 })).toEqual({ ok: true, status: 200, data: { level: 2 } });
  });

  it("202도 성공이고 status로 구분한다", async () => {
    fetchMock.mockResolvedValue(json(202, { status: "ending", retryAfterSeconds: 3 }));

    expect(await api("POST", "/api/chat/sessions/s1/end")).toEqual({
      ok: true,
      status: 202,
      data: { status: "ending", retryAfterSeconds: 3 },
    });
  });

  it("body가 비어 있으면 data는 {}다", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    expect(await api("POST", "/api/me/consent")).toEqual({ ok: true, status: 200, data: {} });
  });
});

describe("api 실패", () => {
  it.each([
    [400, "INVALID_INPUT", "다른 레벨의 상황이에요."],
    [404, "NOT_FOUND", "대화를 찾을 수 없어요."],
    [409, "CONFLICT", "이미 처리 중이에요."],
    [429, "LIMIT_REACHED", "오늘 대화 턴을 모두 썼어요."],
    [503, "AI_UNAVAILABLE", "응답을 받지 못했어요."],
  ])("%i %s는 서버의 code와 message를 그대로 전달한다", async (status, code, message) => {
    fetchMock.mockResolvedValue(json(status, { code, message }));

    expect(await api("POST", "/api/x", {})).toEqual({ ok: false, status, code, message });
    expect(assign).not.toHaveBeenCalled();
  });

  it("message가 없으면 code의 기본 문구를 쓴다", async () => {
    fetchMock.mockResolvedValue(json(409, { code: "CONFLICT" }));

    expect(await api("POST", "/api/x")).toEqual({
      ok: false,
      status: 409,
      code: "CONFLICT",
      message: ERRORS.CONFLICT.message,
    });
  });

  it("JSON이 아닌 응답(Vercel 타임아웃 HTML)은 INTERNAL이다", async () => {
    fetchMock.mockResolvedValue(new Response("<html>An error occurred</html>", { status: 500 }));

    expect(await api("POST", "/api/x")).toEqual({
      ok: false,
      status: 500,
      code: "INTERNAL",
      message: ERRORS.INTERNAL.message,
    });
  });

  it("모르는 code면 INTERNAL과 기본 문구를 쓴다", async () => {
    fetchMock.mockResolvedValue(json(502, { code: "BAD_GATEWAY", message: "upstream" }));

    expect(await api("POST", "/api/x")).toEqual({
      ok: false,
      status: 502,
      code: "INTERNAL",
      message: ERRORS.INTERNAL.message,
    });
  });

  it("fetch가 throw하면 NETWORK이고 재시도하지 않는다", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await api("POST", "/api/x", { a: 1 })).toEqual({
      ok: false,
      status: null,
      code: "NETWORK",
      message: NETWORK_MESSAGE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("api 이동", () => {
  it("401이면 /로 보내고 실패 결과도 돌려준다", async () => {
    fetchMock.mockResolvedValue(json(401, { code: "UNAUTHORIZED", message: "로그인이 필요해요." }));

    const result = await api("POST", "/api/x");

    expect(assign).toHaveBeenCalledWith("/");
    expect(result).toEqual({ ok: false, status: 401, code: "UNAUTHORIZED", message: "로그인이 필요해요." });
  });

  it.each(["CONSENT_REQUIRED", "ONBOARDING_REQUIRED"])("403 %s면 /onboarding으로 보낸다", async (code) => {
    fetchMock.mockResolvedValue(json(403, { code, message: "준비가 필요해요." }));

    const result = await api("POST", "/api/x");

    expect(assign).toHaveBeenCalledWith("/onboarding");
    expect(result).toMatchObject({ ok: false, status: 403, code });
  });
});
