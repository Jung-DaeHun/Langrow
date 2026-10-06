import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUsers } from "@/test/db";
import { callRpc, toDbResult } from "./rpc";

afterEach(deleteTestUsers);

describe("toDbResult", () => {
  it("성공 응답은 ok를 뺀 나머지 키를 value로 돌려준다", () => {
    expect(toDbResult("f", { ok: true })).toEqual({ ok: true, value: {} });
    expect(toDbResult("f", { ok: true, pro_until: "2026-10-13T00:00:00+00:00" })).toEqual({
      ok: true,
      value: { pro_until: "2026-10-13T00:00:00+00:00" },
    });
  });

  it("예상된 거부는 code를 돌려준다", () => {
    expect(toDbResult("f", { ok: false, code: "CONFLICT" })).toEqual({ ok: false, code: "CONFLICT" });
    expect(toDbResult("f", { ok: false, code: "CONSENT_REQUIRED" })).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
  });

  it("DB가 돌려줄 수 없는 code는 throw한다", () => {
    expect(() => toDbResult("f", { ok: false, code: "UNAUTHORIZED" })).toThrow("f");
    expect(() => toDbResult("f", { ok: false, code: "NOPE" })).toThrow("f");
    expect(() => toDbResult("f", { ok: false })).toThrow("f");
  });

  it("jsonb 응답 형식이 아니면 throw한다", () => {
    for (const data of [null, "ok", 1, [], { ok: "true" }, {}]) {
      expect(() => toDbResult("f", data)).toThrow("f");
    }
  });
});

describe("callRpc (로컬 DB)", () => {
  it("성공 응답을 DbResult로 바꾼다", async () => {
    const user = await createTestUser();
    await expect(callRpc("ensure_profile", { p_user_id: user.id })).resolves.toEqual({ ok: true, value: {} });
  });

  it("예상된 거부를 DbResult로 바꾼다", async () => {
    const user = await createTestUser();
    await expect(callRpc("start_trial", { p_user_id: user.id })).resolves.toEqual({
      ok: false,
      code: "CONSENT_REQUIRED",
    });
  });

  it("예상하지 못한 SQL 오류는 throw한다", async () => {
    // auth.users에 없는 id라 FK 위반
    await expect(callRpc("ensure_profile", { p_user_id: randomUUID() })).rejects.toThrow("ensure_profile");
  });
});
