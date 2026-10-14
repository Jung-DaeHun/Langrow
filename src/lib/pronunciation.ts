// 한글 발음 검사 (spec/chat.md "한글 발음"). 대화는 맞지 않는 발음을 숨기고, 단어 데이터는 오류로 본다.
// 한글 음절이 하나 이상 있어야 한다("..."처럼 기호만 있는 값은 발음이 아니다)
const PRONUNCIATION = /^(?=[^가-힣]*[가-힣])[가-힣\s\-.,?!~…]+$/u;

// 일본어 발음의 받침은 ん(ㄴ)과 っ(ㅅ)뿐이다. 모델이 한국어 습관대로 쓴 받침(타쿠상, 각코)을 규칙대로 맞춘다.
// 숫자는 한글 음절의 종성 번호(0 없음, 1 ㄱ, 4 ㄴ, 7 ㄷ, 16 ㅁ, 17 ㅂ, 19 ㅅ, 21 ㅇ)다
const FINAL_N = 4;
const FINAL_S = 19;
const NASAL_FINALS = new Set([16, 21]);
const STOP_FINALS = new Set([1, 7, 17]);

function normalizeFinals(text: string): string {
  return text.replace(/[가-힣]/gu, (syllable) => {
    const code = syllable.charCodeAt(0) - 0xac00;
    const final = code % 28;
    const target = NASAL_FINALS.has(final) ? FINAL_N : STOP_FINALS.has(final) ? FINAL_S : final;
    return String.fromCharCode(0xac00 + code - final + target);
  });
}

export function cleanPron(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return PRONUNCIATION.test(trimmed) ? normalizeFinals(trimmed) : null;
}
