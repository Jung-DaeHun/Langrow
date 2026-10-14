// 한글 발음 검사 (spec/chat.md "한글 발음"). 대화는 맞지 않는 발음을 숨기고, 단어 데이터는 오류로 본다
const PRONUNCIATION = /^[가-힣\s\-.,?!~…]+$/u;

export function cleanPron(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return PRONUNCIATION.test(trimmed) ? trimmed : null;
}
