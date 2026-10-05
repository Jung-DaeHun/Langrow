import { describe, expect, it } from "vitest";
import { BATCH_MAX, batchSize, hasValidBatchIds, newWordIds, wordStatus } from "./wordBatch";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `en-1-${String(i + 1).padStart(3, "0")}`);

describe("batchSize", () => {
  it("최대 10개다", () => {
    expect(BATCH_MAX).toBe(10);
    expect(batchSize(10, 200)).toBe(10);
    expect(batchSize(30, 200)).toBe(10);
  });

  it("미학습 단어가 0개면 0이다", () => {
    expect(batchSize(10, 0)).toBe(0);
  });

  it("미학습 단어가 1~9개면 그 수만큼이다", () => {
    expect(batchSize(10, 1)).toBe(1);
    expect(batchSize(10, 9)).toBe(9);
  });

  it("남은 한도가 작으면 남은 한도만큼이다", () => {
    expect(batchSize(3, 200)).toBe(3);
    expect(batchSize(0, 200)).toBe(0);
  });

  it("음수가 되지 않는다", () => {
    expect(batchSize(-2, 200)).toBe(0);
  });
});

describe("wordStatus", () => {
  it("알아요를 누르고 빈칸도 맞혔을 때만 known이다", () => {
    expect(wordStatus(true, true)).toBe("known");
    expect(wordStatus(true, false)).toBe("review");
    expect(wordStatus(false, true)).toBe("review");
    expect(wordStatus(false, false)).toBe("review");
  });
});

describe("newWordIds", () => {
  it("이미 학습한 단어를 빼고 순서를 유지한다", () => {
    expect(newWordIds(["a", "b", "c", "d"], new Set(["b", "d"]))).toEqual(["a", "c"]);
  });

  it("전부 기존 단어면 빈 배열이다", () => {
    expect(newWordIds(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });
});

describe("hasValidBatchIds", () => {
  it("서로 다른 1~10개만 허용한다", () => {
    expect(hasValidBatchIds(ids(1))).toBe(true);
    expect(hasValidBatchIds(ids(10))).toBe(true);
  });

  it("0개나 11개 이상은 거부한다", () => {
    expect(hasValidBatchIds([])).toBe(false);
    expect(hasValidBatchIds(ids(11))).toBe(false);
  });

  it("중복이 있으면 거부한다", () => {
    expect(hasValidBatchIds(["en-1-001", "en-1-002", "en-1-001"])).toBe(false);
  });
});
