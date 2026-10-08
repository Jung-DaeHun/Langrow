import { afterEach, describe, expect, it, vi } from "vitest";
import { LEVEL_TEST_SIZE } from "@/lib/levelTest";
import type { Language, Level } from "@/lib/levels";
import type { DbErrorCode } from "@/server/db/types";
import { createFakeDeps } from "@/test/fakes";
import type { Db } from "./deps";
import {
  EXPLAIN_FAILURE_LIMIT_MESSAGE,
  EXPLAIN_UNAVAILABLE_MESSAGE,
  explainWord,
  saveWords,
  submitLevelUp,
} from "./learning";

const USER_ID = "11111111-1111-4111-8111-111111111111";

type Word = { id: string; language: Language; level: Level; example: string };

// en 레벨 2 시험. 정답은 단어마다 다르다 (en-2-001 → a-en-2-001)
const IDS = Array.from({ length: LEVEL_TEST_SIZE }, (_, i) => `en-2-${String(i + 1).padStart(3, "0")}`);
const answerOf = (id: string) => `a-${id}`;
const word = (id: string, overrides: Partial<Word> = {}): Word => ({
  id,
  language: "en",
  level: 2,
  example: `I {{${answerOf(id)}}} it.`,
  ...overrides,
});

// 앞에서부터 correctCount개만 맞힌 답안
function answers(correctCount: number) {
  return IDS.map((id, i) => ({ word_id: id, answer: i < correctCount ? answerOf(id) : "wrong" }));
}

function levelTestDeps(words: (ids: string[]) => Word[] = (ids) => ids.map((id) => word(id))) {
  return createFakeDeps({ db: { getWordsByIds: async (ids) => words(ids) } });
}

describe("saveWords", () => {
  it("[알아요]를 누르고 빈칸도 맞힌 단어만 known이고 나머지는 review로, 요청 언어와 함께 저장한다", async () => {
    const deps = createFakeDeps();

    await saveWords(deps, USER_ID, {
      language: "ja",
      items: [
        { word_id: "ja-1-001", knew: true, correct: true },
        { word_id: "ja-1-002", knew: true, correct: false },
        { word_id: "ja-1-003", knew: false, correct: true },
        { word_id: "ja-1-004", knew: false, correct: false },
      ],
    });

    expect(deps.db.saveWordBatch).toHaveBeenCalledWith(USER_ID, "ja", [
      { wordId: "ja-1-001", status: "known" },
      { wordId: "ja-1-002", status: "review" },
      { wordId: "ja-1-003", status: "review" },
      { wordId: "ja-1-004", status: "review" },
    ]);
  });

  it("RPC가 돌려준 insertedCount를 돌려준다 (기존 단어만 있으면 0)", async () => {
    const deps = createFakeDeps({ db: { saveWordBatch: async () => ({ ok: true, value: { insertedCount: 0 } }) } });

    const result = await saveWords(deps, USER_ID, {
      language: "en",
      items: [{ word_id: "en-1-001", knew: true, correct: true }],
    });

    expect(result).toEqual({ ok: true, value: { insertedCount: 0 } });
  });

  it.each<DbErrorCode>(["LIMIT_REACHED", "ONBOARDING_REQUIRED"])("RPC가 %s면 그대로 돌려준다", async (code) => {
    const deps = createFakeDeps({ db: { saveWordBatch: async () => ({ ok: false, code }) } });

    const result = await saveWords(deps, USER_ID, {
      language: "en",
      items: [{ word_id: "en-1-001", knew: false, correct: false }],
    });

    expect(result).toEqual({ ok: false, code });
  });
});

describe("submitLevelUp", () => {
  it("제출한 word_id들로 단어를 조회한다", async () => {
    const deps = levelTestDeps();

    await submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(20) });

    expect(deps.db.getWordsByIds).toHaveBeenCalledWith(IDS);
  });

  it.each([
    [16, true],
    [15, false],
  ])("%i개를 맞히면 passed: %s로 결과를 저장한다", async (correctCount, passed) => {
    const deps = levelTestDeps();

    await submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(correctCount) });

    expect(deps.db.submitLevelTest).toHaveBeenCalledWith(USER_ID, {
      language: "en",
      fromLevel: 2,
      score: correctCount,
      passed,
    });
  });

  it("passed·level은 RPC 결과를, score는 서버 채점 결과를 돌려주고 wrong에는 제출 순서대로 정답을 담는다", async () => {
    // 조회 결과의 순서가 제출 순서와 달라도 wrong은 제출 순서를 따른다
    const deps = levelTestDeps((ids) => ids.map((id) => word(id)).reverse());
    deps.db.submitLevelTest.mockResolvedValue({ ok: true, value: { passed: false, level: 2 } });

    const result = await submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(17) });

    expect(result).toEqual({
      ok: true,
      value: {
        passed: false,
        level: 2,
        score: 17,
        wrong: IDS.slice(17).map((id) => ({ wordId: id, answer: answerOf(id) })),
      },
    });
  });

  it("합격하면 RPC가 올린 레벨을 돌려준다", async () => {
    const deps = levelTestDeps();
    deps.db.submitLevelTest.mockResolvedValue({ ok: true, value: { passed: true, level: 3 } });

    const result = await submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(20) });

    expect(result).toEqual({ ok: true, value: { passed: true, level: 3, score: 20, wrong: [] } });
  });

  it("일본어는 후리가나 표기까지 같은 답만 정답이다", async () => {
    const JA_IDS = IDS.map((_, i) => `ja-1-${String(i + 1).padStart(3, "0")}`);
    const deps = createFakeDeps({
      db: {
        getWordsByIds: async (ids) =>
          ids.map((id) => ({ id, language: "ja", level: 1, example: "[学校|がっこう]に{{[行|い]った}}。" })),
      },
    });
    const submitted = JA_IDS.map((id, i) => ({ word_id: id, answer: ["行った", "いった"][i] ?? "[行|い]った" }));

    const result = await submitLevelUp(deps, USER_ID, { language: "ja", from_level: 1, answers: submitted });

    expect(deps.db.submitLevelTest).toHaveBeenCalledWith(USER_ID, {
      language: "ja",
      fromLevel: 1,
      score: 18,
      passed: true,
    });
    expect(result.ok && result.value.wrong).toEqual([
      { wordId: "ja-1-001", answer: "[行|い]った" },
      { wordId: "ja-1-002", answer: "[行|い]った" },
    ]);
  });

  it.each<[string, (ids: string[]) => Word[]]>([
    ["단어가 19개만 조회되면", (ids) => ids.slice(1).map((id) => word(id))],
    ["다른 언어의 단어가 섞이면", (ids) => ids.map((id, i) => word(id, i === 0 ? { language: "ja" } : {}))],
    ["다른 레벨의 단어가 섞이면", (ids) => ids.map((id, i) => word(id, i === 0 ? { level: 3 } : {}))],
  ])("%s INVALID_INPUT이고 결과를 저장하지 않는다", async (_label, words) => {
    const deps = levelTestDeps(words);

    const result = await submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(20) });

    expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(deps.db.submitLevelTest).not.toHaveBeenCalled();
  });

  it("예문에서 정답을 꺼낼 수 없으면 throw하고 결과를 저장하지 않는다", async () => {
    const deps = levelTestDeps((ids) => ids.map((id, i) => word(id, i === 0 ? { example: "No blank here." } : {})));

    await expect(
      submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(20) }),
    ).rejects.toThrow();
    expect(deps.db.submitLevelTest).not.toHaveBeenCalled();
  });

  it("RPC가 CONFLICT(실제 레벨이 다르거나 재제출)면 그대로 돌려준다", async () => {
    const deps = levelTestDeps();
    deps.db.submitLevelTest.mockResolvedValue({ ok: false, code: "CONFLICT" });

    const result = await submitLevelUp(deps, USER_ID, { language: "en", from_level: 2, answers: answers(20) });

    expect(result).toEqual({ ok: false, code: "CONFLICT" });
  });
});

describe("explainWord", () => {
  // 기본 가짜 단어(src/test/fakes.ts): "I {{went}} to school." / 보기 goes·gone·going / 뜻 가다
  const WORD_ID = "en-1-001";
  const GENERATED = "과거의 일이라 went를 써요.";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("저장본이 있으면 그대로 돌려주고 AI와 저장을 부르지 않는다", async () => {
    const deps = createFakeDeps({
      db: { beginWordExplanation: async () => ({ ok: true, value: { state: "cached", explanation: "저장된 설명" } }) },
    });

    expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "goes" })).toEqual({
      ok: true,
      value: { explanation: "저장된 설명" },
    });
    expect(deps.db.beginWordExplanation).toHaveBeenCalledWith(USER_ID, WORD_ID, "goes");
    expect(deps.ai.generateExplanation).not.toHaveBeenCalled();
    expect(deps.db.saveWordExplanation).not.toHaveBeenCalled();
  });

  it("저장본이 없으면 DB 단어로 AI를 부르고, 성공하면 저장한 뒤 설명을 돌려준다", async () => {
    const deps = createFakeDeps();

    expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "goes" })).toEqual({
      ok: true,
      value: { explanation: GENERATED },
    });
    expect(deps.db.getWord).toHaveBeenCalledWith(WORD_ID);
    expect(deps.ai.generateExplanation).toHaveBeenCalledWith({
      language: "en",
      level: 1,
      sentence: "I went to school.",
      exampleKo: "나는 학교에 갔다.",
      answer: "went",
      meaningKo: "가다",
      choice: "goes",
    });
    expect(deps.db.saveWordExplanation).toHaveBeenCalledWith(WORD_ID, "goes", GENERATED);
    const order = [deps.db.beginWordExplanation, deps.ai.generateExplanation, deps.db.saveWordExplanation].map(
      (fn) => fn.mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("복습(choice 없음)은 빈 문자열 키로 예약·저장하고, 프롬프트의 choice는 null이다", async () => {
    const deps = createFakeDeps();

    await explainWord(deps, USER_ID, { word_id: WORD_ID });

    expect(deps.db.beginWordExplanation).toHaveBeenCalledWith(USER_ID, WORD_ID, "");
    expect(deps.ai.generateExplanation).toHaveBeenCalledWith(expect.objectContaining({ choice: null }));
    expect(deps.db.saveWordExplanation).toHaveBeenCalledWith(WORD_ID, "", GENERATED);
  });

  it("정답 보기도 받는다", async () => {
    const deps = createFakeDeps();

    expect((await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "went" })).ok).toBe(true);
    expect(deps.db.beginWordExplanation).toHaveBeenCalledWith(USER_ID, WORD_ID, "went");
  });

  // next build가 테스트 파일도 타입 검사하므로 케이스 타입을 명시한다
  it.each<[string, Db["saveWordExplanation"]]>([
    ["거부돼도(NOT_FOUND)", async () => ({ ok: false, code: "NOT_FOUND" })],
    [
      "throw해도",
      async () => {
        throw new Error("RPC save_word_explanation 실패: 08006 connection");
      },
    ],
  ])("저장이 %s 설명을 돌려주고, 설명 내용 없이 로그만 남긴다", async (_, saveWordExplanation) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = createFakeDeps({ db: { saveWordExplanation } });

    expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "goes" })).toEqual({
      ok: true,
      value: { explanation: GENERATED },
    });
    expect(error).toHaveBeenCalledOnce();
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain(WORD_ID);
    expect(line).not.toContain(GENERATED);
    expect(line).not.toContain("goes");
  });

  it("없는 단어는 404이고 예약·AI를 부르지 않는다", async () => {
    const deps = createFakeDeps({ db: { getWord: async () => null } });

    expect(await explainWord(deps, USER_ID, { word_id: "en-1-999", choice: "goes" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(deps.db.beginWordExplanation).not.toHaveBeenCalled();
    expect(deps.ai.generateExplanation).not.toHaveBeenCalled();
  });

  it.each(["wrong", "Went", "went "])("그 단어의 보기가 아닌 choice(%j)는 400이고 예약·AI를 부르지 않는다", async (choice) => {
    const deps = createFakeDeps();

    expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(deps.db.beginWordExplanation).not.toHaveBeenCalled();
    expect(deps.ai.generateExplanation).not.toHaveBeenCalled();
  });

  it.each<DbErrorCode>(["LIMIT_REACHED", "CONSENT_REQUIRED", "ONBOARDING_REQUIRED", "NOT_FOUND"])(
    "예약이 %s로 거부되면 그대로 돌려주고 AI를 부르지 않는다",
    async (code) => {
      const deps = createFakeDeps({ db: { beginWordExplanation: async () => ({ ok: false, code }) } });

      expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "goes" })).toEqual({ ok: false, code });
      expect(deps.ai.generateExplanation).not.toHaveBeenCalled();
      expect(deps.db.saveWordExplanation).not.toHaveBeenCalled();
    },
  );

  it("예약이 AI_FAILURE_LIMIT로 거부되면 설명용 문구로 돌려주고 AI를 부르지 않는다", async () => {
    const deps = createFakeDeps({
      db: { beginWordExplanation: async () => ({ ok: false, code: "AI_FAILURE_LIMIT" }) },
    });

    expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "goes" })).toEqual({
      ok: false,
      code: "AI_FAILURE_LIMIT",
      message: EXPLAIN_FAILURE_LIMIT_MESSAGE,
    });
    expect(deps.ai.generateExplanation).not.toHaveBeenCalled();
  });

  it("AI가 실패하면 예약 id와 실패 사유로 실패 RPC를 부르고 503과 설명 실패 문구를 돌려준다. 저장하지 않는다", async () => {
    const deps = createFakeDeps({
      db: { beginWordExplanation: async () => ({ ok: true, value: { state: "reserved", eventId: 42 } }) },
      ai: { generateExplanation: async () => ({ ok: false, reason: "timeout" }) },
    });

    expect(await explainWord(deps, USER_ID, { word_id: WORD_ID, choice: "goes" })).toEqual({
      ok: false,
      code: "AI_UNAVAILABLE",
      message: EXPLAIN_UNAVAILABLE_MESSAGE,
    });
    expect(deps.db.failWordExplanation).toHaveBeenCalledWith(USER_ID, 42, "timeout");
    expect(deps.db.saveWordExplanation).not.toHaveBeenCalled();
  });
});
