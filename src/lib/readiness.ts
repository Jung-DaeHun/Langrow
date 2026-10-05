import type { Language, Level } from "./levels";

export type ReadinessState = {
  agreedAt: Date | null;
  currentLanguage: Language | null;
  levels: Partial<Record<Language, Level>>;
};

// login: consent API / consent: levels API, language API(+ 대상 언어) / ready: 나머지 API와 보호 페이지
export type Requirement = "login" | "consent" | "ready";

export function checkReadiness(
  state: ReadinessState,
  requirement: Requirement,
  language?: Language,
): "ok" | "CONSENT_REQUIRED" | "ONBOARDING_REQUIRED" {
  if (requirement === "login") return "ok";
  if (state.agreedAt === null) return "CONSENT_REQUIRED";
  if (language !== undefined && state.levels[language] === undefined) return "ONBOARDING_REQUIRED";
  if (requirement === "ready") {
    if (state.currentLanguage === null || state.levels[state.currentLanguage] === undefined) {
      return "ONBOARDING_REQUIRED";
    }
  }
  return "ok";
}
