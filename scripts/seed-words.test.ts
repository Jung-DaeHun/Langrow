import { describe, expect, it } from "vitest";
import type { WordEntry } from "@/lib/words";
import { validWordFile } from "@/test/wordFiles";
import { main, type SeedWordsDeps } from "./seed-words";

function fakeDeps(files: Record<string, string>) {
  const upserts: WordEntry[][] = [];
  const logs: string[] = [];
  const deps: SeedWordsDeps = {
    listWordFiles: async () => Object.keys(files),
    readFile: async (name) => files[name],
    upsertWords: async (rows) => {
      upserts.push(rows);
    },
    log: (line) => logs.push(line),
  };
  return { deps, upserts, logs };
}

const json = (data: unknown) => JSON.stringify(data, null, 2);

describe("seed-words main", () => {
  it("올바른 파일을 모두 나눠서 upsert하고, 행은 파일 내용과 같다", async () => {
    const files = { "en-1.json": validWordFile("en", 1), "ja-2.json": validWordFile("ja", 2), "ja-5.json": validWordFile("ja", 5) };
    const { deps, upserts } = fakeDeps(Object.fromEntries(Object.entries(files).map(([name, words]) => [name, json(words)])));

    expect(await main(deps)).toBe(0);

    expect(upserts.length).toBeGreaterThan(1);
    expect(upserts.flat()).toEqual([...files["en-1.json"], ...files["ja-2.json"], ...files["ja-5.json"]]);
  });

  it("파일 하나라도 잘못되면 아무것도 upsert하지 않고 오류를 모두 출력한다", async () => {
    const broken = validWordFile("en", 2);
    broken[9] = { ...broken[9], example: "no blank" };
    broken[19] = { ...broken[19], distractors: ["a", "a", "b"] };
    const { deps, upserts, logs } = fakeDeps({ "en-1.json": json(validWordFile("en", 1)), "en-2.json": json(broken) });

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    const output = logs.join("\n");
    expect(output).toContain("en-2.json");
    expect(output).toContain("en-2-010");
    expect(output).toContain("en-2-020");
  });

  it("파일 이름과 내용의 언어·레벨이 다르면 실패한다", async () => {
    const { deps, upserts, logs } = fakeDeps({ "ja-1.json": json(validWordFile("en", 1)) });

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("language");
  });

  it("JSON이 깨진 파일이 있으면 실패한다", async () => {
    const { deps, upserts, logs } = fakeDeps({ "en-1.json": "[{" });

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("en-1.json");
  });

  it("단어 파일이 없으면 안내를 출력하고 실패한다 (규칙 밖 이름은 무시한다)", async () => {
    const { deps, upserts, logs } = fakeDeps({ "README.md": "", "fr-1.json": "[]", "en-6.json": "[]" });

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("words:generate");
  });
});
