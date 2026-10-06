export const CHAT_INPUT_MAX = 300;

// 클라이언트 글자 수 표시와 서버 검증이 함께 쓴다. 이모지도 코드 포인트 1개로 센다
export function countChars(s: string): number {
  return [...s.trim()].length;
}

export function isValidChatInput(s: string): boolean {
  const n = countChars(s);
  return n >= 1 && n <= CHAT_INPUT_MAX;
}

// 교정 라벨을 고른다: 한국어로 입력했으면 "이렇게 말하면 돼요"
export function hasHangul(s: string): boolean {
  return /\p{Script=Hangul}/u.test(s);
}
