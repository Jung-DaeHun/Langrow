import { describe, expect, it } from "vitest";
import { exampleAudioPath, kanaAudioPath, wordAudioPath } from "@/lib/audio";
import type { WordEntry } from "@/lib/words";
import { validWord } from "@/test/wordFiles";
import { main, plannedAudio, ssmlHash, type GenerateAudioDeps, type Manifest } from "./generate-audio";

const WORDS: WordEntry[] = [validWord("en", 1, 1), validWord("ja", 1, 1)];
const ALL = plannedAudio(WORDS); // 단어 2개 × 2 + 가나 71 = 75
const FULL_MANIFEST: Manifest = Object.fromEntries(ALL.map((a) => [a.path, a.hash]));
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const ok = () => new Response(MP3, { status: 200 });
const tooMany = (retryAfter?: string) =>
  new Response("", { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : {} });

type Options = {
  args?: string[];
  env?: GenerateAudioDeps["env"];
  manifest?: Manifest;
  existing?: string[];
  responses?: (() => Response)[];
};

function fakeDeps(options: Options = {}) {
  const written = new Map<string, Uint8Array>();
  const manifests: Manifest[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const existing = new Set(options.existing ?? []);
  const queue = [...(options.responses ?? [])];
  const deps: GenerateAudioDeps = {
    args: options.args ?? [],
    env: options.env ?? { key: "test-key", region: "koreacentral" },
    readWords: async () => WORDS,
    readManifest: async () => ({ ...(options.manifest ?? {}) }),
    writeManifest: async (m) => {
      manifests.push({ ...m });
    },
    audioExists: async (path) => existing.has(path) || written.has(path),
    writeAudio: async (path, bytes) => {
      written.set(path, bytes);
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return (queue.shift() ?? ok)();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => logs.push(line),
  };
  return { deps, written, manifests, requests, sleeps, logs };
}

describe("plannedAudio", () => {
  it("언어별 음성 이름을 SSML에 넣고, SSML이 다르면 해시도 다르다", () => {
    expect(ALL[0].ssml).toContain('<voice name="en-US-AvaNeural">');
    expect(ALL[2].ssml).toContain('<voice name="ja-JP-NanamiNeural">');
    expect(ALL[0].hash).toBe(ssmlHash(ALL[0].ssml));
    expect(ALL[0].hash).toHaveLength(16);
    expect(ssmlHash("a")).not.toBe(ssmlHash("b"));
  });
});

describe("generate-audio main", () => {
  it("처음 실행하면 모든 항목을 Azure로 만들고 파일마다 manifest를 갱신한다", async () => {
    const { deps, written, manifests, requests } = fakeDeps();

    expect(await main(deps)).toBe(0);

    expect(requests).toHaveLength(75);
    expect(requests[0].url).toBe("https://koreacentral.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": "test-key",
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
    });
    expect(requests[0].init.body).toBe(ALL[0].ssml);
    expect(written.size).toBe(75);
    expect(written.get(ALL[0].path)).toEqual(MP3);
    expect(manifests).toHaveLength(75);
    expect(manifests.at(-1)).toEqual(FULL_MANIFEST);
  });

  it("요청 사이를 3초 이상 띄운다(첫 요청 전에는 기다리지 않는다)", async () => {
    const { deps, sleeps } = fakeDeps();

    await main(deps);

    expect(sleeps).toHaveLength(74);
    expect(sleeps.every((ms) => ms >= 3000)).toBe(true);
  });

  it("manifest 해시가 같고 파일이 있으면 건너뛴다", async () => {
    const { deps, requests, logs } = fakeDeps({ manifest: FULL_MANIFEST, existing: ALL.map((a) => a.path) });

    expect(await main(deps)).toBe(0);

    expect(requests).toHaveLength(0);
    expect(logs.join("\n")).toContain("0개 만듦, 75개 건너뜀");
  });

  it("해시가 다르면(단어를 고쳤거나 음성을 바꿈) 그 항목만 다시 만든다", async () => {
    const stale = ALL[3].path;
    const { deps, requests, written } = fakeDeps({
      manifest: { ...FULL_MANIFEST, [stale]: "0000000000000000" },
      existing: ALL.map((a) => a.path),
    });

    expect(await main(deps)).toBe(0);

    expect(requests).toHaveLength(1);
    expect([...written.keys()]).toEqual([stale]);
  });

  it("manifest에 있어도 파일이 없으면 다시 만든다", async () => {
    const missing = ALL[5].path;
    const { deps, written } = fakeDeps({
      manifest: FULL_MANIFEST,
      existing: ALL.map((a) => a.path).filter((p) => p !== missing),
    });

    expect(await main(deps)).toBe(0);

    expect([...written.keys()]).toEqual([missing]);
  });

  it("429면 Retry-After초만큼 기다렸다가 같은 항목을 다시 보낸다", async () => {
    const { deps, requests, sleeps, written } = fakeDeps({ args: ["--ids", "en-1-001"], responses: [() => tooMany("7")] });

    expect(await main(deps)).toBe(0);

    expect(requests).toHaveLength(3);
    expect(requests[1].init.body).toBe(requests[0].init.body);
    expect(sleeps).toContain(7000);
    expect(written.size).toBe(2);
  });

  it("Retry-After가 없으면 60초 기다린다", async () => {
    const { deps, sleeps } = fakeDeps({ args: ["--ids", "あ"], responses: [() => tooMany()] });

    expect(await main(deps)).toBe(0);

    expect(sleeps).toContain(60000);
  });

  it("Retry-After가 3초보다 짧아도 요청 간격(3초 이상)을 지킨다", async () => {
    const { deps, sleeps } = fakeDeps({ args: ["--ids", "あ"], responses: [() => tooMany("1")] });

    expect(await main(deps)).toBe(0);

    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(3000);
  });

  it("429가 5번 이어지면 멈춘다", async () => {
    const { deps, written } = fakeDeps({ args: ["--ids", "あ"], responses: Array.from({ length: 5 }, () => () => tooMany("1")) });

    expect(await main(deps)).toBe(1);

    expect(written.size).toBe(0);
  });

  it("그 밖의 오류 응답이면 멈추고, 이미 만든 파일과 manifest는 남긴다", async () => {
    const { deps, written, manifests, logs } = fakeDeps({
      args: ["--ids", "en-1-001"],
      responses: [ok, () => new Response("bad request", { status: 400 })],
    });

    expect(await main(deps)).toBe(1);

    expect(written.size).toBe(1);
    expect(manifests).toHaveLength(1);
    expect(logs.join("\n")).toContain("400");
  });

  it("빈 응답이면 멈춘다", async () => {
    const { deps, written } = fakeDeps({ args: ["--ids", "あ"], responses: [() => new Response(new Uint8Array(), { status: 200 })] });

    expect(await main(deps)).toBe(1);

    expect(written.size).toBe(0);
  });

  it("--ids는 그 단어(단어·예문)와 가나만 만든다", async () => {
    const { deps, written } = fakeDeps({ args: ["--ids", "ja-1-001,あ"] });

    expect(await main(deps)).toBe(0);

    expect([...written.keys()]).toEqual([wordAudioPath("ja-1-001"), exampleAudioPath("ja-1-001"), kanaAudioPath("あ")]);
  });

  it("--ids에 맞는 항목이 없으면 실패한다", async () => {
    const { deps, requests } = fakeDeps({ args: ["--ids", "nope"] });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
  });

  it("키나 지역이 없으면 Azure를 부르지 않고 실패한다", async () => {
    const { deps, requests, logs } = fakeDeps({ env: { key: undefined, region: "koreacentral" } });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
    expect(logs.join("\n")).toContain("AZURE_SPEECH_KEY");
  });

  it("지역이 없어도 Azure를 부르지 않고 실패한다", async () => {
    const { deps, requests, logs } = fakeDeps({ env: { key: "test-key", region: undefined } });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
    expect(logs.join("\n")).toContain("AZURE_SPEECH_REGION");
  });

  it("모르는 옵션이면 사용법을 출력한다", async () => {
    const { deps, logs } = fakeDeps({ args: ["--bogus"] });

    expect(await main(deps)).toBe(1);

    expect(logs.join("\n")).toContain("사용법");
  });
});
