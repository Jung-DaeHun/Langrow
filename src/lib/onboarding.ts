import { LANGUAGES, type Language } from "./levels";
import { checkReadiness, type ReadinessState } from "./readiness";

// /onboarding의 시작 단계(spec 1장 "온보딩 도중 이탈", "언어 바꿈"). 저장된 상태에서 다시 계산하므로 이탈해도 그 단계부터 이어진다
export type OnboardingStart =
  | { kind: "home" }
  | { kind: "consent"; language?: Language } // 동의 뒤 language가 있으면 레벨 단계로
  | { kind: "language" }
  | { kind: "level"; language: Language; mode: "first" | "add" };

function toLanguage(param: string | undefined): Language | undefined {
  return LANGUAGES.find((lang) => lang === param);
}

export function onboardingStart(state: ReadinessState, languageParam: string | undefined): OnboardingStart {
  const language = toLanguage(languageParam);
  if (state.agreedAt === null) return language === undefined ? { kind: "consent" } : { kind: "consent", language };

  if (language !== undefined) {
    // 이미 레벨이 있는 언어로의 전환은 언어 시트(PUT /api/me/language)가 한다
    if (state.levels[language] !== undefined) return { kind: "home" };
    const hasOtherLevel = Object.values(state.levels).some((level) => level !== undefined);
    return { kind: "level", language, mode: hasOtherLevel ? "add" : "first" };
  }

  return checkReadiness(state, "ready") === "ok" ? { kind: "home" } : { kind: "language" };
}
