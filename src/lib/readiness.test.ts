import { describe, expect, it } from "vitest";
import { type ReadinessState, checkReadiness } from "./readiness";

const agreedAt = new Date("2026-10-01T00:00:00Z");
const fresh: ReadinessState = { agreedAt: null, currentLanguage: null, levels: {} };
const ready: ReadinessState = { agreedAt, currentLanguage: "en", levels: { en: 2 } };

describe("checkReadiness: login", () => {
  it("상태와 무관하게 ok다", () => {
    expect(checkReadiness(fresh, "login")).toBe("ok");
    expect(checkReadiness(fresh, "login", "ja")).toBe("ok");
  });
});

describe("checkReadiness: consent", () => {
  it("동의가 없으면 CONSENT_REQUIRED다", () => {
    expect(checkReadiness(fresh, "consent")).toBe("CONSENT_REQUIRED");
  });

  it("동의만 있으면 레벨이 없어도 ok다", () => {
    expect(checkReadiness({ ...fresh, agreedAt }, "consent")).toBe("ok");
  });

  it("언어를 주면 그 언어의 레벨이 있어야 한다", () => {
    expect(checkReadiness(ready, "consent", "ja")).toBe("ONBOARDING_REQUIRED");
    expect(checkReadiness(ready, "consent", "en")).toBe("ok");
  });

  it("현재 언어가 없어도 대상 언어의 레벨이 있으면 ok다", () => {
    expect(checkReadiness({ ...ready, currentLanguage: null }, "consent", "en")).toBe("ok");
  });

  it("동의가 없으면 언어를 줘도 CONSENT_REQUIRED다", () => {
    expect(checkReadiness({ ...ready, agreedAt: null }, "consent", "ja")).toBe("CONSENT_REQUIRED");
  });
});

describe("checkReadiness: ready", () => {
  it("동의와 현재 언어의 레벨이 있으면 ok다", () => {
    expect(checkReadiness(ready, "ready")).toBe("ok");
    expect(checkReadiness(ready, "ready", "en")).toBe("ok");
  });

  it("둘 다 없으면 동의를 먼저 요구한다", () => {
    expect(checkReadiness(fresh, "ready")).toBe("CONSENT_REQUIRED");
  });

  it("현재 언어가 없으면 ONBOARDING_REQUIRED다", () => {
    expect(checkReadiness({ ...ready, currentLanguage: null }, "ready")).toBe("ONBOARDING_REQUIRED");
  });

  it("현재 언어의 레벨이 없으면 ONBOARDING_REQUIRED다", () => {
    expect(checkReadiness({ ...ready, currentLanguage: "ja" }, "ready")).toBe("ONBOARDING_REQUIRED");
  });

  it("요청 언어의 레벨이 없으면 ONBOARDING_REQUIRED다", () => {
    expect(checkReadiness(ready, "ready", "ja")).toBe("ONBOARDING_REQUIRED");
  });
});
