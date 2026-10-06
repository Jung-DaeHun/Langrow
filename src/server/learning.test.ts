import { describe, expect, it } from "vitest";
import { LEVEL_TEST_SIZE } from "@/lib/levelTest";
import type { Language, Level } from "@/lib/levels";
import type { DbErrorCode } from "@/server/db/types";
import { createFakeDeps } from "@/test/fakes";
import { saveWords, submitLevelUp } from "./learning";

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
