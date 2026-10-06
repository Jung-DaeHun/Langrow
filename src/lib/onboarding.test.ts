import { describe, expect, it } from "vitest";
import { onboardingStart } from "./onboarding";
import type { ReadinessState } from "./readiness";

const agreedAt = new Date("2026-10-01T00:00:00Z");
const fresh: ReadinessState = { agreedAt: null, currentLanguage: null, levels: {} };
const agreed: ReadinessState = { agreedAt, currentLanguage: null, levels: {} };
const ready: ReadinessState = { agreedAt, currentLanguage: "en", levels: { en: 3 } };

describe("onboardingStart: 미동의", () => {
  it("동의 단계부터 시작한다", () => {
    expect(onboardingStart(fresh, undefined)).toEqual({ kind: "consent" });
  });

  it("유효한 language가 있으면 동의 뒤 레벨 단계로 가도록 담는다", () => {
    expect(onboardingStart(fresh, "ja")).toEqual({ kind: "consent", language: "ja" });
  });

  it("모르는 language는 없는 것으로 본다", () => {
    expect(onboardingStart(fresh, "fr")).toEqual({ kind: "consent" });
    expect(onboardingStart(fresh, "")).toEqual({ kind: "consent" });
  });
});

describe("onboardingStart: language 파라미터", () => {
  it("이미 그 언어의 레벨이 있으면 홈이다", () => {
    expect(onboardingStart(ready, "en")).toEqual({ kind: "home" });
  });

  it("다른 언어의 레벨이 있으면 언어 추가 모드로 레벨 단계다", () => {
    expect(onboardingStart(ready, "ja")).toEqual({ kind: "level", language: "ja", mode: "add" });
  });

  it("레벨이 하나도 없으면 첫 레벨 모드로 레벨 단계다", () => {
    expect(onboardingStart(agreed, "ja")).toEqual({ kind: "level", language: "ja", mode: "first" });
  });

  it("모르는 language는 없는 것으로 본다", () => {
    expect(onboardingStart(ready, "fr")).toEqual({ kind: "home" });
    expect(onboardingStart(agreed, "EN")).toEqual({ kind: "language" });
  });
});

describe("onboardingStart: language 파라미터 없음", () => {
  it("준비가 끝났으면 홈이다", () => {
    expect(onboardingStart(ready, undefined)).toEqual({ kind: "home" });
  });

  it("동의만 했으면 언어 단계다", () => {
    expect(onboardingStart(agreed, undefined)).toEqual({ kind: "language" });
  });

  it("현재 언어의 레벨이 없으면 언어 단계다", () => {
    expect(onboardingStart({ agreedAt, currentLanguage: "ja", levels: { en: 2 } }, undefined)).toEqual({
      kind: "language",
    });
  });
});
