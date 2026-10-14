// 한글 발음 검사 (spec/chat.md "한글 발음"). 대화는 맞지 않는 발음을 숨기고, 단어 데이터는 오류로 본다.
// 한글 음절이 하나 이상 있어야 한다("..."처럼 기호만 있는 값은 발음이 아니다)
const PRONUNCIATION = /^(?=[^가-힣]*[가-힣])[가-힣\s\-.,?!~…]+$/u;

export function cleanPron(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return PRONUNCIATION.test(trimmed) ? trimmed : null;
}
