import * as fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseBlank } from "@/lib/blank";
import { isLevel, type Level } from "@/lib/levels";
import { cleanPron } from "@/lib/pronunciation";
import { PRONUNCIATION_RULES } from "@/services/claude/prompts";
import { getClaudeEnv } from "@/services/env";

// 일본어 단어 파일의 한글 발음(pron_ko·example_pron_ko) 중 비었거나 검사에 맞지 않는 값만 Claude로 채운다
// (spec/words.md "단어 데이터"). 검사에 맞는 값은 바꾸지 않는다. 묶음마다 파일을 써서 중간에 멈춰도 앞 묶음은 남는다

const BATCH_SIZE = 50;

export type PronSource = { id: string; word: string; reading: string; sentence: string };
export type PronRequest = { model: string | undefined; items: PronSource[] };

export type GeneratePronunciationDeps = {
  args: string[];
  generate: (request: PronRequest) => Promise<unknown[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  log: (line: string) => void;
};

type Entry = Record<string, unknown>;

const USAGE = "사용법: npm run words:pron -- --language ja --level <1-5> [--model <모델 ID>]";

function parseCliArgs(args: string[]): { level: Level; model: string | undefined } | null {
  try {
    const { values } = parseArgs({
      args,
      options: { language: { type: "string" }, level: { type: "string" }, model: { type: "string" } },
    });
    const level = Number(values.level);
    return values.language === "ja" && isLevel(level) ? { level, model: values.model } : null;
  } catch {
    return null; // 모르는 옵션, 값이 없는 옵션
  }
}

function needsPron(entry: Entry): boolean {
  return cleanPron(entry.pron_ko) === null || cleanPron(entry.example_pron_ko) === null;
}

// 정답을 채운 예문. {{ }}는 빼고 [漢字|かな] 표기는 남겨 한자의 읽기를 알려 준다
function toSource(entry: Entry): PronSource | null {
  const blank = typeof entry.example === "string" ? parseBlank(entry.example) : null;
  if (typeof entry.id !== "string" || typeof entry.word !== "string" || typeof entry.reading !== "string" || !blank) {
    return null;
  }
  return { id: entry.id, word: entry.word, reading: entry.reading, sentence: blank.before + blank.answer + blank.after };
}

function itemsById(items: unknown[]): Map<string, Entry> {
  const byId = new Map<string, Entry>();
  for (const item of items) {
    if (typeof item === "object" && item !== null && typeof (item as Entry).id === "string") {
      byId.set((item as Entry).id as string, item as Entry);
    }
  }
  return byId;
}

export async function main(deps: GeneratePronunciationDeps): Promise<number> {
  const parsed = parseCliArgs(deps.args);
  if (!parsed) {
    deps.log(USAGE);
    return 1;
  }
  const path = `data/words/ja-${parsed.level}.json`;
  const entries = JSON.parse(await deps.readFile(path)) as unknown;
  if (!Array.isArray(entries)) {
    deps.log(`${path}는 단어 배열이어야 합니다`);
    return 1;
  }

  const failed: string[] = [];
  const todo: { entry: Entry; source: PronSource }[] = [];
  for (const entry of entries as Entry[]) {
    if (!needsPron(entry)) continue;
    const source = toSource(entry);
    if (source) todo.push({ entry, source });
    else failed.push(String(entry.id));
  }
  if (todo.length === 0 && failed.length === 0) {
    deps.log(`${path}에 채울 발음이 없습니다`);
    return 0;
  }

  let filled = 0;
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const chunk = todo.slice(start, start + BATCH_SIZE);
    const byId = itemsById(await deps.generate({ model: parsed.model, items: chunk.map((t) => t.source) }));
    for (const { entry, source } of chunk) {
      const item = byId.get(source.id);
      const pron = cleanPron(item?.pron_ko);
      const examplePron = cleanPron(item?.example_pron_ko);
      if (cleanPron(entry.pron_ko) === null && pron !== null) entry.pron_ko = pron;
      if (cleanPron(entry.example_pron_ko) === null && examplePron !== null) entry.example_pron_ko = examplePron;
      if (needsPron(entry)) failed.push(source.id);
      else filled++;
    }
    await deps.writeFile(path, `${JSON.stringify(entries, null, 2)}\n`);
    deps.log(`${Math.min(start + BATCH_SIZE, todo.length)} / ${todo.length}`);
  }

  deps.log(`${path}: ${filled}개 채움`);
  if (failed.length > 0) {
    deps.log(`채우지 못한 단어 ${failed.length}개: ${failed.join(", ")}. 다시 실행하면 이 단어만 다시 요청합니다`);
    return 1;
  }
  deps.log("검수한 뒤 커밋하세요");
  return 0;
}

// ---- 실제 deps (Anthropic API, 파일). 테스트는 가짜 deps만 쓴다 ----

// thinking이 한도를 먼저 써서 목록이 잘리지 않게 넉넉히 둔다. 이만큼 크면 SDK가 스트리밍을 요구한다
const MAX_TOKENS = 32_000;

const pronBatchSchema = z.object({
  items: z.array(z.object({ id: z.string(), pron_ko: z.string(), example_pron_ko: z.string() })),
});

function buildPrompt(items: PronSource[]): { system: string; user: string } {
  return {
    system: "너는 한국인 학습자를 위한 일본어 단어장에 한글 발음을 다는 편집자다.",
    user: [
      "항목마다 id를 그대로 두고 다음을 채운다.",
      "- pron_ko: word를 reading대로 읽은 한글 발음",
      "- example_pron_ko: sentence 전체의 한글 발음. [漢字|かな] 표기의 한자는 かな대로 읽는다",
      "",
      "한글 발음 규칙:",
      PRONUNCIATION_RULES,
      "",
      "항목:",
      JSON.stringify(items),
    ].join("\n"),
  };
}

function createGenerate(): GeneratePronunciationDeps["generate"] {
  let client: Anthropic | undefined;
  return async (request) => {
    const env = getClaudeEnv();
    client ??= new Anthropic({ apiKey: env.apiKey });
    const { system, user } = buildPrompt(request.items);
    try {
      const message = await client.messages
        .stream({
          model: request.model ?? env.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(pronBatchSchema), effort: "medium" },
        })
        .finalMessage();
      // 거절되거나 잘린 응답은 빈 묶음으로 보고, main이 그 단어들을 실패 목록에 남긴다
      if (message.stop_reason !== "end_turn" || message.parsed_output === null) {
        console.error(`빈 묶음: stop_reason ${message.stop_reason}, 출력 ${message.usage.output_tokens}토큰`);
        return [];
      }
      return message.parsed_output.items;
    } catch (error) {
      // 인증·사용량 같은 API 오류는 멈춘다. JSON 파싱·스키마 검증 실패만 빈 묶음으로 본다
      if (error instanceof Anthropic.APIError) throw error;
      console.error(`빈 묶음: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };
}

function realDeps(): GeneratePronunciationDeps {
  return {
    args: process.argv.slice(2),
    generate: createGenerate(),
    readFile: (path) => fs.readFile(path, "utf8"),
    writeFile: (path, content) => fs.writeFile(path, content),
    log: (line) => console.log(line),
  };
}

// import만 해서는 실행하지 않는다 (테스트가 import한다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(realDeps()).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
