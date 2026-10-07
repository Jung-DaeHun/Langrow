export type FuriganaSegment = { text: string; reading?: string };

// 온전한 표기: [본문|읽기]. 본문과 읽기는 비어 있지 않고 [, ], |를 포함하지 않는다
const RUBY = /\[([^[\]|]+)\|([^[\]|]+)\]/g;
// 온전한 표기 밖에 남은 [, ], |는 깨진 표기의 흔적이라 지운다
const BROKEN_MARKS = /[[\]|]/g;
// 읽기는 한자에만 단다. 모델이 가나·한글에 단 읽기([コーヒー|こーひー])는 버린다
const KANJI = /\p{Script=Han}/u;

// HTML을 만들지 않고 segment만 돌려준다. 그리기는 Furigana 컴포넌트가 <ruby>로 한다
export function parseFurigana(input: string): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  const pushText = (raw: string) => {
    const text = raw.replace(BROKEN_MARKS, "");
    if (!text) return;
    const prev = segments.at(-1);
    if (prev && prev.reading === undefined) prev.text += text;
    else segments.push({ text });
  };
  let last = 0;
  for (const match of input.matchAll(RUBY)) {
    pushText(input.slice(last, match.index));
    if (KANJI.test(match[1])) segments.push({ text: match[1], reading: match[2] });
    else pushText(match[1]);
    last = match.index + match[0].length;
  }
  pushText(input.slice(last));
  return segments;
}

export function stripFurigana(input: string): string {
  return parseFurigana(input)
    .map((s) => s.text)
    .join("");
}
