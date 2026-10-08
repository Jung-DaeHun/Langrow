import { vi, type Mocked } from "vitest";
import { scenariosForLevel } from "@/lib/scenarios";
import type { Db } from "@/server/deps";
import type { Ai } from "@/services/claude/client";

// use-case·route 테스트용 가짜 db·ai. 모든 함수는 vi.fn이고 기본값은 정상 경로의 성공 결과다.
// 결과는 overrides나 mockResolvedValueOnce로 바꾸고, 순서는 mock.invocationCallOrder로 검증한다.
// RPC 규칙(잠금·한도·상태 전이)은 여기서 다시 구현하지 않는다. 그 동작은 test:db가 증명한다

// 기본 계정: 동의함, 현재 언어 en, en 레벨 1
const SESSION = { language: "en", level: 1, scenarioId: scenariosForLevel(1)[0].id } as const;
const TOKEN = "00000000-0000-4000-8000-0000000000aa";

function defaultDb(): Db {
  return {
    ensureProfile: async () => {},
    agreeTerms: async () => {},
    setFirstLevel: async () => ({ ok: true, value: null }),
    switchLanguage: async () => ({ ok: true, value: null }),
    lowerLevel: async (_userId, _language, level) => ({ ok: true, value: { level } }),
    startTrial: async () => ({ ok: true, value: { proUntil: new Date("2026-10-13T00:00:00Z") } }),
    getReadiness: async () => ({ agreedAt: new Date("2026-10-01T00:00:00Z"), currentLanguage: "en", levels: { en: 1 } }),
    createChatSession: async () => ({ ok: true, value: { sessionId: "00000000-0000-4000-8000-000000000001" } }),
    beginChatTurn: async () => ({ ok: true, value: { token: TOKEN, turnNo: 1, session: SESSION, history: [] } }),
    finishChatTurn: async () => ({ ok: true, value: { turnsLeft: 19 } }),
    failChatTurn: async () => ({ ok: true, value: null }),
    beginEnd: async () => ({
      ok: true,
      value: {
        state: "reserved",
        token: TOKEN,
        session: SESSION,
        turns: [{ userText: "Hi, I'm Minji.", reply: "Nice to meet you, Minji!", correction: null }],
      },
    }),
    finishEnd: async (_userId, _sessionId, _token, feedback) => ({
      ok: true,
      value: { feedbackStatus: "ready", feedback },
    }),
    failEnd: async () => ({
      ok: true,
      value: {
        feedbackStatus: "fallback",
        feedback: { message: "대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요." },
      },
    }),
    saveWordBatch: async (_userId, _language, items) => ({ ok: true, value: { insertedCount: items.length } }),
    saveReview: async (_userId, _language, items) => ({ ok: true, value: { reviewedCount: items.length } }),
    submitLevelTest: async () => ({ ok: true, value: { passed: true, level: 2 } }),
    recordEvent: async () => ({ ok: true, value: null }),
    getWordsByIds: async (ids) => ids.map((id) => ({ id, language: "en", level: 1, example: "This is a {{pen}}." })),
    // 정답 went, 보기 goes·gone·going
    getWord: async (id) => ({
      id,
      language: "en",
      level: 1,
      meaningKo: "가다",
      example: "I {{went}} to school.",
      exampleKo: "나는 학교에 갔다.",
      distractors: ["goes", "gone", "going"],
    }),
    beginWordExplanation: async () => ({ ok: true, value: { state: "reserved", eventId: 1 } }),
    failWordExplanation: async () => ({ ok: true, value: null }),
    saveWordExplanation: async () => ({ ok: true, value: null }),
  };
}

function defaultAi(): Ai {
  return {
    generateTurn: async () => ({
      ok: true,
      value: {
        reply: "Nice to meet you! Where are you from?",
        reply_ko: "만나서 반가워요! 어디에서 왔어요?",
        correction: { corrected: "I'm Minji.", explanation_ko: "이름을 말할 때는 I'm을 붙여요." },
      },
    }),
    generateFeedback: async () => ({
      ok: true,
      value: { good: "자기소개를 끝까지 이어 갔어요.", improve: ["I'm으로 문장을 시작해 보세요."] },
    }),
  };
}

function mockAll<T extends object>(impl: T): Mocked<T> {
  return Object.fromEntries(
    Object.entries(impl).map(([name, fn]) => [name, vi.fn(fn as (...args: unknown[]) => unknown)]),
  ) as Mocked<T>;
}

export function createFakeDb(overrides: Partial<Db> = {}): Mocked<Db> {
  return mockAll({ ...defaultDb(), ...overrides });
}

export function createFakeAi(overrides: Partial<Ai> = {}): Mocked<Ai> {
  return mockAll({ ...defaultAi(), ...overrides });
}

export function createFakeDeps(overrides: { db?: Partial<Db>; ai?: Partial<Ai> } = {}): {
  db: Mocked<Db>;
  ai: Mocked<Ai>;
} {
  return { db: createFakeDb(overrides.db), ai: createFakeAi(overrides.ai) };
}
