import { describe, expect, it } from "vitest";
import {
  SLOW_RATE,
  audioItems,
  escapeXml,
  exampleAudioPath,
  exampleSpeech,
  kanaAudioPath,
  pickVoice,
  ssmlDocument,
  wordAudioPath,
  wordSpeech,
  type SpeechWord,
} from "./audio";

const en = (overrides: Partial<SpeechWord> = {}): SpeechWord => ({
  id: "en-3-010",
  language: "en",
  word: "reason",
  reading: null,
  example: "What is the {{reason}} for the delay?",
  ...overrides,
});
const ja = (overrides: Partial<SpeechWord> = {}): SpeechWord => ({
  id: "ja-2-003",
  language: "ja",
  word: "違う",
  reading: "ちがう",
  example: "[答|こた]えが{{[違|ちが]って}}います。",
  ...overrides,
});

describe("음성 파일 경로", () => {
  it("단어·예문은 female/words 아래 단어 ID로 둔다", () => {
    expect(wordAudioPath("en-1-001")).toBe("/audio/female/words/en-1-001.mp3");
    expect(exampleAudioPath("en-1-001")).toBe("/audio/female/words/en-1-001-ex.mp3");
  });

  it("가나는 히라가나 코드포인트(16진수 소문자)로 둔다", () => {
    expect(kanaAudioPath("あ")).toBe("/audio/female/kana/3042.mp3");
    expect(kanaAudioPath("ん")).toBe("/audio/female/kana/3093.mp3");
  });

  it("가타카나는 소리가 같은 히라가나 파일을 쓴다", () => {
    expect(kanaAudioPath("ア")).toBe(kanaAudioPath("あ"));
    expect(kanaAudioPath("ヂ")).toBe(kanaAudioPath("ぢ"));
    expect(kanaAudioPath("ン")).toBe(kanaAudioPath("ん"));
    expect(kanaAudioPath("ヲ")).toBe(kanaAudioPath("を"));
  });
});

describe("SSML 본문", () => {
  it("XML 특수 문자를 이스케이프한다", () => {
    expect(escapeXml(`Tom & Jerry <3 "hi" 'yo'`)).toBe("Tom &amp; Jerry &lt;3 &quot;hi&quot; &apos;yo&apos;");
  });

  it("영어 단어는 그대로(이스케이프만), 예문은 {{ }}를 지운다", () => {
    expect(wordSpeech(en({ word: "rock & roll" }))).toBe("rock &amp; roll");
    expect(exampleSpeech(en())).toBe("What is the reason for the delay?");
    expect(exampleSpeech(en({ example: "Salt {{&}} pepper <3" }))).toBe("Salt &amp; pepper &lt;3");
  });

  it("일본어 단어는 한자가 있고 reading이 다르면 <sub alias>로 읽기를 지정한다", () => {
    expect(wordSpeech(ja())).toBe('<sub alias="ちがう">違う</sub>');
  });

  it("한자가 없거나 reading이 같으면 그대로 둔다", () => {
    expect(wordSpeech(ja({ word: "はい", reading: "はい" }))).toBe("はい");
    expect(wordSpeech(ja({ word: "コーヒー", reading: "こーひー" }))).toBe("コーヒー");
    expect(wordSpeech(ja({ word: "本", reading: null }))).toBe("本");
  });

  it("일본어 예문은 {{ }}를 지우고 후리가나를 <sub alias>로 바꾼다", () => {
    expect(exampleSpeech(ja())).toBe('<sub alias="こた">答</sub>えが<sub alias="ちが">違</sub>っています。');
  });

  it("SSML 문서에 locale과 음성 이름을 넣는다", () => {
    expect(ssmlDocument("ja", "ja-JP-NanamiNeural", "はい")).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP"><voice name="ja-JP-NanamiNeural">はい</voice></speak>',
    );
  });
});

describe("audioItems", () => {
  it("단어마다 단어·예문 2개, 그리고 히라가나 71자를 만든다", () => {
    const items = audioItems([en(), ja()]);

    expect(items).toHaveLength(4 + 71);
    expect(items.slice(0, 4)).toEqual([
      { path: "/audio/female/words/en-3-010.mp3", source: "en-3-010", language: "en", body: "reason" },
      { path: "/audio/female/words/en-3-010-ex.mp3", source: "en-3-010", language: "en", body: "What is the reason for the delay?" },
      { path: "/audio/female/words/ja-2-003.mp3", source: "ja-2-003", language: "ja", body: '<sub alias="ちがう">違う</sub>' },
      {
        path: "/audio/female/words/ja-2-003-ex.mp3",
        source: "ja-2-003",
        language: "ja",
        body: '<sub alias="こた">答</sub>えが<sub alias="ちが">違</sub>っています。',
      },
    ]);
    expect(items[4]).toEqual({ path: "/audio/female/kana/3042.mp3", source: "あ", language: "ja", body: "あ" });
  });

  it("경로가 겹치지 않는다(가타카나 파일을 따로 만들지 않는다)", () => {
    const paths = audioItems([en(), ja()]).map((i) => i.path);

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p.includes("/kana/"))).toHaveLength(71);
  });
});

describe("pickVoice", () => {
  it("locale이 같은 음성을 언어만 같은 음성보다 먼저 고른다", () => {
    const voices = [{ lang: "en-GB", n: 1 }, { lang: "en-US", n: 2 }];

    expect(pickVoice(voices, "en")?.n).toBe(2);
  });

  it("밑줄 locale(ja_JP)도 고른다", () => {
    expect(pickVoice([{ lang: "ja_JP" }], "ja")).toEqual({ lang: "ja_JP" });
  });

  it("locale이 같은 음성이 없으면 언어가 같은 첫 음성을 고른다", () => {
    expect(pickVoice([{ lang: "ko-KR" }, { lang: "en-GB" }, { lang: "en-AU" }], "en")).toEqual({ lang: "en-GB" });
    expect(pickVoice([{ lang: "ja" }], "ja")).toEqual({ lang: "ja" });
  });

  it("학습 언어 음성이 없으면 null이다(접두어만 같은 언어도 아니다)", () => {
    expect(pickVoice([{ lang: "ko-KR" }, { lang: "en-US" }], "ja")).toBeNull();
    expect(pickVoice([{ lang: "enx" }], "en")).toBeNull();
  });

  it("천천히 듣기 속도는 0.75다", () => {
    expect(SLOW_RATE).toBe(0.75);
  });
});
