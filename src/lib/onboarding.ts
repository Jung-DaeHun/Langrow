import { LANGUAGES, type Language } from "./levels";
import { checkReadiness, type ReadinessState } from "./readiness";

// /onboarding의 시작 단계(spec/journey.md "예외 흐름"의 "온보딩 도중 이탈", "언어를 바꿈"). 저장된 상태에서 다시 계산하므로 이탈해도 그 단계부터 이어진다
export type OnboardingStart =
  | { kind: "home" }
  | { kind: "consent"; language?: Language } // 동의 뒤 언어 단계로. language가 있으면 그 언어를 미리 고른다
  | { kind: "language"; language?: Language } // language가 있으면 미리 고른다
  | { kind: "add"; language: Language }; // 다른 언어 레벨이 있는 사용자의 새 언어: 시작 확인 단계

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
    return hasOtherLevel ? { kind: "add", language } : { kind: "language", language };
  }

  return checkReadiness(state, "ready") === "ok" ? { kind: "home" } : { kind: "language" };
}
