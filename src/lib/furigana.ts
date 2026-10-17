export type FuriganaSegment = { text: string; reading?: string };

// 온전한 표기 [본문|읽기], 또는 여는 괄호만 빠진 표기 앞말|읽기]. 본문·앞말·읽기는 비어 있지 않고 [, ], |를 포함하지 않는다
const RUBY = /\[([^[\]|]+)\|([^[\]|]+)\]|([^[\]|]+)\|([^[\]|]+)\]/g;
// 온전한 표기 밖에 남은 [, ], |는 깨진 표기의 흔적이라 지운다
const BROKEN_MARKS = /[[\]|]/g;
// 읽기는 한자에만 단다. 모델이 가나·한글에 단 읽기([コーヒー|こーひー])는 버린다
const KANJI = /\p{Script=Han}/u;
// 여는 괄호만 빠진 표기의 본문은 | 바로 앞의 한자 묶음이다
const KANJI_TAIL = /\p{Script=Han}+$/u;
// 가타카나 묶음: 가타카나 글자(ァ~ヴ)로 시작해 가타카나 글자와 장음 ー가 이어진 부분. ・는 묶음을 끊는다.
// ヵ·ヶ는 뺀다. 3ヶ月처럼 か·が·こ로 읽어서 같은 소리의 히라가나(ゕ·ゖ)가 읽기가 되지 않는다
const KATAKANA_RUN = /[ァ-ヴ][ァ-ヴー]*/g;
const KATAKANA = /[ァ-ヴ]/g;

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
    const [, body, reading, before, lostReading] = match;
    if (body !== undefined) {
      if (KANJI.test(body)) segments.push({ text: body, reading });
      else pushText(body);
    } else if (input[match.index - 1] === "|") {
      // |가 두 개인 [漢字|かん|じ]의 뒷부분이다. 여는 괄호만 빠진 표기가 아니라 깨진 표기로 둔다
      pushText(match[0]);
    } else {
      const kanji = before.match(KANJI_TAIL)?.[0] ?? "";
      pushText(before.slice(0, before.length - kanji.length));
      if (kanji) segments.push({ text: kanji, reading: lostReading });
    }
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

// 화면용(spec/chat.md "후리가나"). 가타카나 읽기는 같은 소리의 히라가나라 AI 없이 코드가 단다.
// parseFurigana는 음성 SSML(lib/audio)도 쓰므로 가타카나 읽기를 넣지 않는다
export function rubySegments(input: string): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  for (const segment of parseFurigana(input)) {
    if (segment.reading !== undefined) {
      segments.push(segment);
      continue;
    }
    let last = 0;
    for (const match of segment.text.matchAll(KATAKANA_RUN)) {
      if (match.index > last) segments.push({ text: segment.text.slice(last, match.index) });
      // 같은 소리의 히라가나는 코드포인트가 0x60 앞이다. ー는 그대로 둔다
      const reading = match[0].replace(KATAKANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
      segments.push({ text: match[0], reading });
      last = match.index + match[0].length;
    }
    if (last < segment.text.length) segments.push({ text: segment.text.slice(last) });
  }
  return segments;
}
