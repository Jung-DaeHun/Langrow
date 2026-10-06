import { describe, expect, it } from "vitest";
import { validWord, validWordFile } from "@/test/wordFiles";
import type { Language, Level } from "./levels";
import { WORDS_PER_LEVEL, validateWordFile, wordEntryErrors, wordId, type WordEntry } from "./words";

// 0번째 단어(en-1-001 / ja-1-001)만 바꾼 파일
function fileWith(change: Partial<Record<keyof WordEntry, unknown>>, language: Language = "en", level: Level = 1) {
  const file: Record<string, unknown>[] = validWordFile(language, level);
  file[0] = { ...file[0], ...change };
  return file;
}

function errorsOf(language: Language, level: Level, data: unknown): string[] {
  const result = validateWordFile(language, level, data);
  if (result.ok) throw new Error("검사를 통과했다");
  return result.errors;
}

// 오류 문구에 단어 id와 이유가 함께 있는지 본다
function expectError(errors: string[], ...parts: string[]) {
  expect(errors.some((error) => parts.every((part) => error.includes(part)))).toBe(true);
}

describe("wordId", () => {
  it("언어-레벨-세 자리 rank다", () => {
    expect(wordId("en", 1, 1)).toBe("en-1-001");
    expect(wordId("ja", 5, 200)).toBe("ja-5-200");
  });
});

describe("wordEntryErrors", () => {
  it("단어 하나의 규칙만 보고 이유를 돌려준다", () => {
    expect(wordEntryErrors("ja", 2, validWord("ja", 2, 7))).toEqual([]);
    expect(wordEntryErrors("ja", 2, { ...validWord("ja", 2, 7), reading: null })).toEqual([
      "일본어는 reading(히라가나 읽기)이 있어야 합니다",
    ]);
    expect(wordEntryErrors("en", 1, null)).toEqual(["객체가 아닙니다"]);
  });
});

describe("validateWordFile", () => {
  it("올바른 200개는 통과하고 단어를 그대로 돌려준다", () => {
    for (const language of ["en", "ja"] as const) {
      const file = validWordFile(language, 3);
      expect(validateWordFile(language, 3, file)).toEqual({ ok: true, words: file });
    }
  });

  it("배열이 아니면 실패한다", () => {
    expect(errorsOf("en", 1, { words: [] }).length).toBeGreaterThan(0);
  });

  it(`정확히 ${WORDS_PER_LEVEL}개가 아니면 실패한다`, () => {
    expectError(errorsOf("en", 1, validWordFile("en", 1).slice(0, 199)), "199");
    expectError(errorsOf("en", 1, [...validWordFile("en", 1), validWord("en", 1, 201)]), "201");
  });

  it("빠진 rank와 중복된 rank를 잡아낸다", () => {
    const file = validWordFile("en", 1);
    file[4] = { ...file[4], rank: 6, id: wordId("en", 1, 6) };
    const errors = errorsOf("en", 1, file);
    expectError(errors, "en-1-006", "rank", "중복");
    expectError(errors, "빠진 rank", "5");
  });

  it("rank가 1~200 밖이면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ rank: 0 })), "en-1-001", "rank");
  });

  it("id가 언어·레벨·rank와 맞지 않으면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ id: "en-1-1" })), "en-1-1", "en-1-001");
  });

  it("언어·레벨이 파일과 다르면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ language: "ja" })), "en-1-001", "language");
    expectError(errorsOf("en", 1, fileWith({ level: 2 })), "en-1-001", "level");
  });

  it("문자열 필드가 비어 있으면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ meaning_ko: "  " })), "en-1-001", "meaning_ko");
    expectError(errorsOf("en", 1, fileWith({ example_ko: undefined })), "en-1-001", "example_ko");
  });

  it("example의 {{ }}가 0개거나 2개면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ example: "I went to school." })), "en-1-001", "{{ }}");
    expectError(errorsOf("en", 1, fileWith({ example: "I {{went}} to {{school}}." })), "en-1-001", "{{ }}");
  });

  it("distractors가 3개가 아니면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ distractors: ["goes1", "gone1"] })), "en-1-001", "distractors");
  });

  it("distractors끼리 같으면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ distractors: ["goes1", "goes1", "going1"] })), "en-1-001", "distractors");
  });

  it("distractors에 정답이 있으면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ distractors: ["went1", "gone1", "going1"] })), "en-1-001", "정답");
  });

  it("일본어는 reading이 있어야 한다", () => {
    expectError(errorsOf("ja", 1, fileWith({ reading: null }, "ja")), "ja-1-001", "reading");
    expectError(errorsOf("ja", 1, fileWith({ reading: "" }, "ja")), "ja-1-001", "reading");
  });

  it("영어는 reading이 null이어야 한다", () => {
    expectError(errorsOf("en", 1, fileWith({ reading: "go" })), "en-1-001", "reading");
  });

  it("파일 안에서 word가 중복되면 실패한다", () => {
    expectError(errorsOf("en", 1, fileWith({ word: "go2" })), "go2", "중복");
  });

  it("id가 없는 항목은 몇 번째 항목인지 적는다", () => {
    const file: unknown[] = validWordFile("en", 1);
    file[2] = "go";
    expectError(errorsOf("en", 1, file), "3번째");
  });
});
