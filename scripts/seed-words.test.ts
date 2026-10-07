import { describe, expect, it } from "vitest";
import { LANGUAGES, LEVELS } from "@/lib/levels";
import type { WordEntry } from "@/lib/words";
import { validWordFile } from "@/test/wordFiles";
import { main, type SeedWordsDeps } from "./seed-words";

function fakeDeps(files: Record<string, string>, args: string[] = []) {
  const upserts: WordEntry[][] = [];
  const logs: string[] = [];
  const deps: SeedWordsDeps = {
    args,
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

const ALL_FILES = LANGUAGES.flatMap((language) => LEVELS.map((level) => ({ name: `${language}-${level}.json`, language, level })));
const allFiles = () => Object.fromEntries(ALL_FILES.map((f) => [f.name, json(validWordFile(f.language, f.level))]));

describe("seed-words main", () => {
  it("언어 × 레벨 10개 파일이 모두 올바르면 나눠서 upsert하고, 행은 파일 내용과 같다", async () => {
    const { deps, upserts } = fakeDeps(allFiles());

    expect(await main(deps)).toBe(0);

    expect(upserts.length).toBeGreaterThan(1);
    expect(upserts.flat()).toEqual(ALL_FILES.flatMap((f) => validWordFile(f.language, f.level)));
  });

  it("10개 중 빠진 파일이 있으면 그 이름과 --partial 안내를 출력하고 아무것도 넣지 않는다", async () => {
    const files = allFiles();
    delete files["ja-3.json"];
    delete files["en-5.json"];
    const { deps, upserts, logs } = fakeDeps(files);

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    const output = logs.join("\n");
    expect(output).toContain("en-5.json");
    expect(output).toContain("ja-3.json");
    expect(output).toContain("--partial");
  });

  it("--partial이면 빠진 파일을 알리고 있는 파일만 넣는다", async () => {
    const files = { "en-1.json": validWordFile("en", 1), "ja-2.json": validWordFile("ja", 2) };
    const { deps, upserts, logs } = fakeDeps(
      Object.fromEntries(Object.entries(files).map(([name, words]) => [name, json(words)])),
      ["--partial"],
    );

    expect(await main(deps)).toBe(0);

    expect(upserts.flat()).toEqual([...files["en-1.json"], ...files["ja-2.json"]]);
    expect(logs.join("\n")).toContain("ja-5.json");
  });

  it("모르는 옵션이면 사용법을 출력하고 아무것도 넣지 않는다", async () => {
    const { deps, upserts, logs } = fakeDeps(allFiles(), ["--force"]);

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("사용법");
  });

  it("파일 하나라도 잘못되면 아무것도 upsert하지 않고 오류를 모두 출력한다", async () => {
    const broken = validWordFile("en", 2);
    broken[9] = { ...broken[9], example: "no blank" };
    broken[19] = { ...broken[19], distractors: ["a", "a", "b"] };
    const { deps, upserts, logs } = fakeDeps({ "en-1.json": json(validWordFile("en", 1)), "en-2.json": json(broken) }, [
      "--partial",
    ]);

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    const output = logs.join("\n");
    expect(output).toContain("en-2.json");
    expect(output).toContain("en-2-010");
    expect(output).toContain("en-2-020");
  });

  it("파일 이름과 내용의 언어·레벨이 다르면 실패한다", async () => {
    const { deps, upserts, logs } = fakeDeps({ "ja-1.json": json(validWordFile("en", 1)) }, ["--partial"]);

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("language");
  });

  it("JSON이 깨진 파일이 있으면 실패한다", async () => {
    const { deps, upserts, logs } = fakeDeps({ "en-1.json": "[{" }, ["--partial"]);

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("en-1.json");
  });

  it("단어 파일이 없으면 안내를 출력하고 실패한다 (규칙 밖 이름은 무시한다)", async () => {
    const { deps, upserts, logs } = fakeDeps({ "README.md": "", "fr-1.json": "[]", "en-6.json": "[]" }, ["--partial"]);

    expect(await main(deps)).toBe(1);

    expect(upserts).toHaveLength(0);
    expect(logs.join("\n")).toContain("words:generate");
  });
});
