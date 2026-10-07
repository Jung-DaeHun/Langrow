import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { LANGUAGES, LANGUAGE_NAMES, LEVEL_INFO, isLevel, type Language, type Level } from "@/lib/levels";
import { WORDS_PER_LEVEL, validateWordFile, wordEntryErrors, wordId, type WordEntry } from "@/lib/words";
import { getClaudeEnv } from "@/services/env";

// 한 번에 200개를 받으면 응답이 길어져 잘리기 쉽다. 묶음으로 나눠 받는다
const BATCH_SIZE = 50;
// 버린 항목을 채우는 추가 요청까지 포함한 상한. 넘으면 파일을 쓰지 않는다
export const MAX_GENERATE_CALLS = 8;

export type GenerateRequest = {
  model: string | undefined; // 없으면 CLAUDE_MODEL(getClaudeEnv().model)
  language: Language;
  level: Level;
  count: number;
  exclude: string[]; // 이미 받은 단어. 빈도가 더 높아 앞 rank에 들어갔다
  lowerLevelWords: string[]; // 같은 언어의 낮은 레벨에서 배운 단어
};

export type GenerateWordsDeps = {
  args: string[];
  generate: (request: GenerateRequest) => Promise<unknown[]>;
  fileExists: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  log: (line: string) => void;
};

const USAGE = "사용법: npm run words:generate -- --language <en|ja> --level <1-5> [--model <모델 ID>]";

function parseCliArgs(args: string[]): { language: Language; level: Level; model: string | undefined } | null {
  try {
    const { values } = parseArgs({
      args,
      options: { language: { type: "string" }, level: { type: "string" }, model: { type: "string" } },
    });
    const language = LANGUAGES.find((l) => l === values.language);
    const level = Number(values.level);
    return language && isLevel(level) ? { language, level, model: values.model } : null;
  } catch {
    return null; // 모르는 옵션, 값이 없는 옵션
  }
}

// AI 항목에 rank·id를 붙인다. 규칙에 어긋나면 null
function toEntry(language: Language, level: Level, rank: number, item: unknown): WordEntry | null {
  const w = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
  const entry = {
    id: wordId(language, level, rank),
    language,
    level,
    rank,
    word: w.word,
    reading: w.reading,
    meaning_ko: w.meaning_ko,
    example: w.example,
    example_ko: w.example_ko,
    distractors: w.distractors,
  };
  return wordEntryErrors(language, level, entry).length === 0 ? (entry as WordEntry) : null;
}

export async function main(deps: GenerateWordsDeps): Promise<number> {
  const parsed = parseCliArgs(deps.args);
  if (!parsed) {
    deps.log(USAGE);
    return 1;
  }
  const { language, level, model } = parsed;
  const path = `data/words/${language}-${level}.json`;
  // 사람이 검수한 데이터를 지키려고 덮어쓰지 않는다
  if (await deps.fileExists(path)) {
    deps.log(`${path} 파일이 이미 있어서 만들지 않았습니다. 다시 만들려면 파일을 직접 지운 뒤 실행하세요`);
    return 1;
  }

  // 레벨이 올라가도 같은 단어를 다시 배우지 않게 낮은 레벨 단어를 뺀다. 그래서 레벨 1부터 순서대로 만든다
  const lowerLevelWords: string[] = [];
  for (let lower = 1; lower < level; lower++) {
    const lowerPath = `data/words/${language}-${lower}.json`;
    if (!(await deps.fileExists(lowerPath))) {
      deps.log(`${lowerPath} 파일이 없어서 만들지 않았습니다. 레벨 1부터 순서대로 만드세요`);
      return 1;
    }
    const lowerWords = JSON.parse(await deps.readFile(lowerPath)) as { word: string }[];
    lowerLevelWords.push(...lowerWords.map((w) => w.word));
  }

  const words: WordEntry[] = [];
  const seen = new Set<string>(lowerLevelWords);
  for (let call = 1; call <= MAX_GENERATE_CALLS && words.length < WORDS_PER_LEVEL; call++) {
    const count = Math.min(BATCH_SIZE, WORDS_PER_LEVEL - words.length);
    const exclude = words.map((w) => w.word);
    const items = await deps.generate({ model, language, level, count, exclude, lowerLevelWords });
    let accepted = 0;
    for (const item of items) {
      if (words.length === WORDS_PER_LEVEL) break;
      const entry = toEntry(language, level, words.length + 1, item);
      if (!entry || seen.has(entry.word)) continue;
      seen.add(entry.word);
      words.push(entry);
      accepted++;
    }
    deps.log(`${call}번째 요청: ${items.length}개 중 ${accepted}개 채택 (${words.length} / ${WORDS_PER_LEVEL})`);
  }

  if (words.length < WORDS_PER_LEVEL) {
    deps.log(`요청 ${MAX_GENERATE_CALLS}번 안에 ${WORDS_PER_LEVEL}개를 모으지 못해 파일을 쓰지 않았습니다`);
    return 1;
  }
  const result = validateWordFile(language, level, words);
  if (!result.ok) {
    result.errors.forEach((error) => deps.log(error));
    deps.log("검사를 통과하지 못해 파일을 쓰지 않았습니다");
    return 1;
  }
  await deps.writeFile(path, `${JSON.stringify(result.words, null, 2)}\n`);
  deps.log(`${path}에 ${WORDS_PER_LEVEL}개를 썼습니다. 검수한 뒤 커밋하세요`);
  return 0;
}

// ---- 실제 deps (Anthropic API, 파일). 테스트는 가짜 deps만 쓴다 ----

// thinking이 한도를 먼저 써서 단어 목록이 잘리지 않게 넉넉히 둔다. 이만큼 크면 SDK가 스트리밍을 요구한다
const MAX_TOKENS = 64_000;

// 길이·개수 제약은 넣지 않는다. 어긋난 항목은 main이 버리고 더 요청한다
const wordBatchSchema = z.object({
  words: z.array(
    z.object({
      word: z.string(),
      reading: z.string().nullable(),
      meaning_ko: z.string(),
      example: z.string(),
      example_ko: z.string(),
      distractors: z.array(z.string()),
    }),
  ),
});

function buildPrompt({ language, level, count, exclude, lowerLevelWords }: GenerateRequest): { system: string; user: string } {
  const name = LANGUAGE_NAMES[language];
  const info = LEVEL_INFO[level];
  const lines = [
    `${name} ${info.name}(${level}/5) 레벨 학습자에게 맞는 단어 ${count}개를 이 레벨에서 자주 쓰이는 순서(빈도 순)로 골라라.`,
    "품사(명사·동사·형용사·부사 등)를 가리지 않고 실제로 자주 쓰이는 순서대로 섞는다. 품사별로 묶지 않는다.",
    `레벨 설명: ${info.description}. 레벨은 입문(1)부터 고수(5)까지이며, 더 낮은 레벨에서 배울 기초 단어는 넣지 않는다.`,
    "아래 '이미 고른 단어'는 빈도가 더 높아 앞에 넣은 단어다. 이 단어들과 겹치지 않게 그다음으로 자주 쓰이는 단어부터 고른다.",
    "",
    "항목마다 다음을 채운다.",
    "- word: 사전에 실리는 기본형",
    language === "ja" ? "- reading: word의 읽기를 히라가나로만 쓴다" : "- reading: null",
    "- meaning_ko: 짧은 한국어 뜻",
    "- example: word를 쓴 짧은 예문. 문장 속 정답 표기를 {{ }}로 정확히 한 번 감싼다",
    "- example_ko: 예문의 자연스러운 한국어 번역",
    "- distractors: 그 문장에 넣으면 틀리는 보기 3개. 서로 다르고 {{ }} 안의 정답과도 다르다",
    "  - 정답과 다른 형태를 3개 만들 수 있는 단어(동사 등)는 같은 단어의 다른 형태를 쓴다",
    "  - 만들 수 없는 단어(명사·부사 등)는 example_ko의 뜻과 맞지 않는 같은 품사의 다른 단어를 쓴다. 학습자는 한국어 문장을 보고 고른다",
    "  - 보기는 활용 어미를 자르지 않은 완전한 형태로 쓴다. 어간만 남긴 조각은 보기로 쓰지 않는다",
    "",
    "예: word go, example `I {{went}} to school.`, distractors goes, gone, going",
    "예: word book, example `I read a {{book}} before bed.`, example_ko 나는 자기 전에 책을 읽는다., distractors chair, river, window",
  ];
  if (language === "ja") {
    lines.push(
      "일본어는 example, {{ }} 안의 정답, distractors의 모든 한자에 [漢字|かな] 형식으로 읽기를 단다.",
      "보기는 `[違|ちが]わない`, `[重|おも]ければ`처럼 완전한 형태로 쓴다. `[違|ちが]わ`, `[重|おも]けれ`, `[古|ふる]かっ` 같은 조각은 쓰지 않는다.",
      "예: word 行く, reading いく, example `[学校|がっこう]に{{[行|い]った}}。`, distractors `[行|い]く`, `[行|い]って`, `[行|い]かない`",
      "예: word 水, reading みず, example `{{[水|みず]}}を[飲|の]みたいです。`, example_ko 물을 마시고 싶어요., distractors `[本|ほん]`, `[駅|えき]`, `[先生|せんせい]`",
    );
  }
  if (lowerLevelWords.length > 0) {
    lines.push("", `낮은 레벨에서 이미 배운 단어(넣지 않는다): ${lowerLevelWords.join(", ")}`);
  }
  lines.push("", `이미 고른 단어: ${exclude.length > 0 ? exclude.join(", ") : "(없음)"}`);
  return { system: `너는 한국인 학습자를 위한 ${name} 단어장을 만드는 편집자다.`, user: lines.join("\n") };
}

function createGenerate(): GenerateWordsDeps["generate"] {
  let client: Anthropic | undefined;
  return async (request) => {
    const env = getClaudeEnv();
    client ??= new Anthropic({ apiKey: env.apiKey });
    const { system, user } = buildPrompt(request);
    try {
      const message = await client.messages
        .stream({
          model: request.model ?? env.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(wordBatchSchema) },
        })
        .finalMessage();
      // 거절되거나 잘린 응답은 빈 묶음으로 보고 main이 다시 요청한다
      if (message.stop_reason !== "end_turn" || message.parsed_output === null) {
        console.error(`빈 묶음: stop_reason ${message.stop_reason}, 출력 ${message.usage.output_tokens}토큰`);
        return [];
      }
      return message.parsed_output.words;
    } catch (error) {
      // 인증·사용량 같은 API 오류는 멈춘다. JSON 파싱·스키마 검증 실패만 빈 묶음으로 본다
      if (error instanceof Anthropic.APIError) throw error;
      console.error(`빈 묶음: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };
}

function realDeps(): GenerateWordsDeps {
  return {
    args: process.argv.slice(2),
    generate: createGenerate(),
    fileExists: (path) => fs.access(path).then(
      () => true,
      () => false,
    ),
    readFile: (path) => fs.readFile(path, "utf8"),
    writeFile: async (path, content) => {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, content, { flag: "wx" }); // 그사이 파일이 생겼어도 덮어쓰지 않는다
    },
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
