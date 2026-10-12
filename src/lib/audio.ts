import { parseFurigana } from "./furigana";
import { KANA } from "./kana";
import type { Language } from "./levels";

// 음성 파일 경로와 읽을 내용(spec/audio.md). 생성 스크립트와 화면이 같이 쓴다.
// 지금은 여성 음성만 만든다. 남성 음성은 나중에 "male" 폴더로 같은 구조를 추가한다
const VOICE_DIR = "female";

export const SLOW_RATE = 0.75;

// Azure SSML의 xml:lang이자 브라우저 음성을 고를 때 먼저 찾는 locale
export const SPEECH_LOCALE: Record<Language, string> = { en: "en-US", ja: "ja-JP" };

export function wordAudioPath(wordId: string): string {
  return `/audio/${VOICE_DIR}/words/${wordId}.mp3`;
}

export function exampleAudioPath(wordId: string): string {
  return `/audio/${VOICE_DIR}/words/${wordId}-ex.mp3`;
}

const KATAKANA_FIRST = 0x30a1; // ァ
const KATAKANA_LAST = 0x30f6; // ヶ
const KATAKANA_TO_HIRAGANA = 0x60; // ア(30A2) − あ(3042)

// 가타카나는 소리가 같은 히라가나 파일을 쓴다
export function kanaAudioPath(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  const hiragana = code >= KATAKANA_FIRST && code <= KATAKANA_LAST ? code - KATAKANA_TO_HIRAGANA : code;
  return `/audio/${VOICE_DIR}/kana/${hiragana.toString(16)}.mp3`;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type SpeechWord = { id: string; language: Language; word: string; reading: string | null; example: string };

const HAN = /\p{Script=Han}/u;
const BLANK_MARKS = /\{\{|\}\}/g;

function sub(text: string, alias: string): string {
  return `<sub alias="${escapeXml(alias)}">${escapeXml(text)}</sub>`;
}

// 일본어는 데이터의 읽기를 <sub alias>로 넘겨 한자를 잘못 읽지 않게 한다
export function wordSpeech(w: SpeechWord): string {
  if (w.language === "ja" && w.reading !== null && w.reading !== w.word && HAN.test(w.word)) return sub(w.word, w.reading);
  return escapeXml(w.word);
}

export function exampleSpeech(w: SpeechWord): string {
  const sentence = w.example.replace(BLANK_MARKS, "");
  if (w.language !== "ja") return escapeXml(sentence);
  return parseFurigana(sentence)
    .map((s) => (s.reading === undefined ? escapeXml(s.text) : sub(s.text, s.reading)))
    .join("");
}

export function ssmlDocument(language: Language, voiceName: string, body: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${SPEECH_LOCALE[language]}"><voice name="${voiceName}">${body}</voice></speak>`;
}

export type AudioItem = { path: string; source: string; language: Language; body: string };

// 만들 음성 목록: 단어마다 단어·예문, 그리고 히라가나 71자(가타카나는 같은 파일을 쓴다)
export function audioItems(words: readonly SpeechWord[]): AudioItem[] {
  const fromWords = words.flatMap((w) => [
    { path: wordAudioPath(w.id), source: w.id, language: w.language, body: wordSpeech(w) },
    { path: exampleAudioPath(w.id), source: w.id, language: w.language, body: exampleSpeech(w) },
  ]);
  const fromKana = KANA.hiragana.map((k) => ({
    path: kanaAudioPath(k.char),
    source: k.char,
    language: "ja" as const,
    body: escapeXml(k.char),
  }));
  return [...fromWords, ...fromKana];
}

// 브라우저 음성: locale이 같은 것(- _ 구분 없이) → 언어가 같은 첫 음성 → 없음.
// 기본 음성으로 대신 읽으면 일본어를 영어 음성으로 읽게 되므로 없으면 null이다
export function pickVoice<T extends { lang: string }>(voices: readonly T[], language: Language): T | null {
  const norm = (lang: string) => lang.replace("_", "-").toLowerCase();
  const locale = SPEECH_LOCALE[language].toLowerCase();
  return (
    voices.find((v) => norm(v.lang) === locale) ??
    voices.find((v) => norm(v.lang) === language || norm(v.lang).startsWith(`${language}-`)) ??
    null
  );
}
