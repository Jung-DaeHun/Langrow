import { parseFurigana, stripFurigana } from "./furigana";

// 문장 뜯어보기(spec/chat.md "문장 뜯어보기"). 조각은 문장 순서대로이고 text는 원래 문장의 부분 문자열이다
export type BreakdownPiece = { text: string; meaning_ko: string };
export type Breakdown = BreakdownPiece[];

// 비교할 때 빼는 글자: 공백, 문장부호, 기호
const IGNORED = /[\s\p{P}\p{S}]/gu;
// 조각 사이에서 뒤 조각에 붙는 글자: 여는 괄호·따옴표(「, (, “)와 통화 기호($)
const OPENING = /^[\p{Ps}\p{Pi}\p{Sc}]$/u;

function normalize(text: string): string {
  return stripFurigana(text).replace(IGNORED, "").toLowerCase();
}

// 문장을 자를 수 있는 단위. 한자 표기 하나는 나눌 수 없는 한 단위이고 나머지는 글자 하나씩이다.
// 표기는 parseFurigana가 읽은 대로 다시 쓴다(온전한 표기는 그대로, 깨진 표기는 화면에 보이는 모양으로)
function unitsOf(sentence: string): { source: string; key: string }[] {
  return parseFurigana(sentence).flatMap((segment) =>
    segment.reading === undefined
      ? [...segment.text].map((char) => ({ source: char, key: normalize(char) }))
      : [{ source: `[${segment.text}|${segment.reading}]`, key: normalize(segment.text) }],
  );
}

// 조각을 이으면 문장과 같은지 검사한다. 통과하면 AI가 준 글자 대신 원래 문장을 조각 경계에서 자른 부분을 돌려준다.
// 조각 사이와 문장 끝의 공백·문장부호는 앞 조각에(여는 괄호·따옴표·통화 기호는 뒤 조각에), 문장 맨 앞의 것은 첫 조각에 붙는다.
// 공백·문장부호만 있는 조각은 문장에서 자를 자리가 없어 빼고 검사한다
export function alignBreakdown(sentence: string, pieces: readonly BreakdownPiece[]): Breakdown | null {
  const kept = pieces.filter((piece) => normalize(piece.text));
  if (kept.length === 0) return null;
  const meanings = kept.map((piece) => piece.meaning_ko.trim());
  const keys = kept.map((piece) => normalize(piece.text));
  if (meanings.some((meaning) => !meaning)) return null;
  const units = unitsOf(sentence);
  if (keys.join("") !== units.map((unit) => unit.key).join("")) return null;

  const texts = kept.map(() => "");
  let index = 0;
  let filled = 0;
  let end = keys[0].length;
  for (const unit of units) {
    if (filled === end && index < keys.length - 1 && (unit.key || OPENING.test(unit.source))) {
      index += 1;
      end += keys[index].length;
    }
    // 한자 표기 하나가 두 조각에 걸친다
    if (filled + unit.key.length > end) return null;
    texts[index] += unit.source;
    filled += unit.key.length;
  }
  return texts.map((text, i) => ({ text: text.trim(), meaning_ko: meanings[i] }));
}
