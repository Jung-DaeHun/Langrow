import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { audioItems, ssmlDocument } from "@/lib/audio";
import type { Language } from "@/lib/levels";
import type { WordEntry } from "@/lib/words";

// 단어·예문·가나 음성을 Azure Speech(F0)로 만들어 public/audio/에 쓴다(spec/audio.md).
// manifest의 SSML 해시가 같고 파일이 있으면 건너뛰므로, 끊겨도 다시 돌리면 이어서 만들고 바뀐 것만 다시 만든다

const WORDS_DIR = "data/words";
const WORD_FILE = /^(en|ja)-[1-5]\.json$/;
export const MANIFEST_PATH = "data/audio-manifest.json";
// 바꾸면 SSML이 달라져 전부 다시 만든다(spec/audio.md "읽을 내용"의 음성)
export const AZURE_VOICES: Record<Language, string> = { en: "en-US-AvaNeural", ja: "ja-JP-NanamiNeural" };
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const REQUEST_GAP_MS = 3_100; // F0는 분당 20회
const DEFAULT_RETRY_SECONDS = 60;
const MAX_429_IN_A_ROW = 5;
const USAGE = "사용법: npm run audio:generate [-- --ids <word_id 또는 가나>,...]";

export type Manifest = Record<string, string>;
export type PlannedAudio = { path: string; source: string; ssml: string; hash: string };

export function ssmlHash(ssml: string): string {
  return createHash("sha256").update(ssml).digest("hex").slice(0, 16);
}

export function plannedAudio(words: readonly WordEntry[]): PlannedAudio[] {
  return audioItems(words).map((item) => {
    const ssml = ssmlDocument(item.language, AZURE_VOICES[item.language], item.body);
    return { path: item.path, source: item.source, ssml, hash: ssmlHash(ssml) };
  });
}

export type GenerateAudioDeps = {
  args: string[];
  env: { key: string | undefined; region: string | undefined };
  readWords: () => Promise<WordEntry[]>;
  readManifest: () => Promise<Manifest>;
  writeManifest: (manifest: Manifest) => Promise<void>;
  audioExists: (path: string) => Promise<boolean>; // path는 "/audio/..."
  writeAudio: (path: string, bytes: Uint8Array) => Promise<void>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

function parseCliArgs(args: string[]): { ids: Set<string> | null } | null {
  try {
    const { values } = parseArgs({ args, options: { ids: { type: "string" } } });
    if (values.ids === undefined) return { ids: null };
    return { ids: new Set(values.ids.split(",").map((s) => s.trim()).filter((s) => s !== "")) };
  } catch {
    return null; // 모르는 옵션
  }
}

// 성공하면 mp3 바이트, 멈춰야 하면 null(이유는 로그)
async function synthesize(deps: GenerateAudioDeps, url: string, key: string, audio: PlannedAudio): Promise<Uint8Array | null> {
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "langrow-generate-audio",
      },
      body: audio.ssml,
    });
    if (res.status === 429) {
      if (attempt >= MAX_429_IN_A_ROW) {
        deps.log(`${audio.path}: 429가 ${MAX_429_IN_A_ROW}번 이어져 멈춥니다`);
        return null;
      }
      const seconds = Number(res.headers.get("retry-after")) || DEFAULT_RETRY_SECONDS;
      deps.log(`429: ${seconds}초 기다렸다가 다시 보냅니다 (${audio.path})`);
      // Retry-After가 짧아도 요청 간격(분당 20회)은 지킨다
      await deps.sleep(Math.max(seconds * 1000, REQUEST_GAP_MS));
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok || bytes.length === 0) {
      const detail = res.ok ? "빈 응답" : new TextDecoder().decode(bytes).slice(0, 200);
      deps.log(`${audio.path}: ${res.status} ${detail}`);
      return null;
    }
    return bytes;
  }
}

export async function main(deps: GenerateAudioDeps): Promise<number> {
  const parsed = parseCliArgs(deps.args);
  if (!parsed) {
    deps.log(USAGE);
    return 1;
  }
  const { key, region } = deps.env;
  if (!key || !region) {
    deps.log("AZURE_SPEECH_KEY·AZURE_SPEECH_REGION이 없습니다. .env.local에 넣고 다시 실행하세요");
    return 1;
  }

  const all = plannedAudio(await deps.readWords());
  const ids = parsed.ids;
  const targets = ids === null ? all : all.filter((a) => ids.has(a.source));
  if (ids !== null && targets.length === 0) {
    deps.log(`--ids에 맞는 항목이 없습니다: ${[...ids].join(", ")}`);
    return 1;
  }

  const manifest = await deps.readManifest();
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  let made = 0;
  let skipped = 0;
  let requested = false;
  for (const audio of targets) {
    if (manifest[audio.path] === audio.hash && (await deps.audioExists(audio.path))) {
      skipped++;
      continue;
    }
    if (requested) await deps.sleep(REQUEST_GAP_MS);
    requested = true;
    const bytes = await synthesize(deps, url, key, audio);
    if (bytes === null) {
      deps.log(`멈춤: ${made}개를 만든 뒤 실패했습니다. 다시 실행하면 이어서 만듭니다`);
      return 1;
    }
    // 파일마다 manifest를 써서 중간에 끊겨도 만든 것은 다시 만들지 않는다
    await deps.writeAudio(audio.path, bytes);
    manifest[audio.path] = audio.hash;
    await deps.writeManifest(manifest);
    made++;
    if (made % 100 === 0) deps.log(`${made}개 만듦 (${made + skipped} / ${targets.length})`);
  }
  deps.log(`완료: ${made}개 만듦, ${skipped}개 건너뜀`);
  return 0;
}

// ---- 실제 deps (파일, Azure). 테스트는 가짜 deps만 쓴다 ----

export async function readWordFiles(dir = WORDS_DIR): Promise<WordEntry[]> {
  const names = (await fs.readdir(dir)).filter((name) => WORD_FILE.test(name)).sort();
  const files = await Promise.all(names.map(async (name) => JSON.parse(await fs.readFile(join(dir, name), "utf8")) as WordEntry[]));
  return files.flat();
}

const publicFile = (path: string) => join("public", path);

// 키 순서를 고정해 diff를 작게 한다
function manifestJson(manifest: Manifest): string {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function realDeps(): GenerateAudioDeps {
  return {
    args: process.argv.slice(2),
    env: { key: process.env.AZURE_SPEECH_KEY, region: process.env.AZURE_SPEECH_REGION },
    readWords: () => readWordFiles(),
    readManifest: async () => {
      try {
        return JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as Manifest;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
      }
    },
    writeManifest: (manifest) => fs.writeFile(MANIFEST_PATH, manifestJson(manifest)),
    audioExists: (path) =>
      fs.access(publicFile(path)).then(
        () => true,
        () => false,
      ),
    writeAudio: async (path, bytes) => {
      await fs.mkdir(dirname(publicFile(path)), { recursive: true });
      await fs.writeFile(publicFile(path), bytes);
    },
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
