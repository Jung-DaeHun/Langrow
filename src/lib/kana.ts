export type KanaScript = "hiragana" | "katakana";
export type Kana = { char: string; romaji: string; ko: string; row: string };

// 행마다 [key, group, 히라가나, 가타카나, romaji(헵번식), 한국어 발음]. 두 문자가 romaji·ko를 같이 쓴다
const ROWS = [
  ["a", "basic", "あいうえお", "アイウエオ", "a i u e o", "아이우에오"],
  ["ka", "basic", "かきくけこ", "カキクケコ", "ka ki ku ke ko", "카키쿠케코"],
  ["sa", "basic", "さしすせそ", "サシスセソ", "sa shi su se so", "사시스세소"],
  ["ta", "basic", "たちつてと", "タチツテト", "ta chi tsu te to", "타치츠테토"],
  ["na", "basic", "なにぬねの", "ナニヌネノ", "na ni nu ne no", "나니누네노"],
  ["ha", "basic", "はひふへほ", "ハヒフヘホ", "ha hi fu he ho", "하히후헤호"],
  ["ma", "basic", "まみむめも", "マミムメモ", "ma mi mu me mo", "마미무메모"],
  ["ya", "basic", "やゆよ", "ヤユヨ", "ya yu yo", "야유요"],
  ["ra", "basic", "らりるれろ", "ラリルレロ", "ra ri ru re ro", "라리루레로"],
  ["wa", "basic", "わをん", "ワヲン", "wa wo n", "와오응"],
  ["ga", "voiced", "がぎぐげご", "ガギグゲゴ", "ga gi gu ge go", "가기구게고"],
  ["za", "voiced", "ざじずぜぞ", "ザジズゼゾ", "za ji zu ze zo", "자지즈제조"],
  ["da", "voiced", "だぢづでど", "ダヂヅデド", "da ji zu de do", "다지즈데도"],
  ["ba", "voiced", "ばびぶべぼ", "バビブベボ", "ba bi bu be bo", "바비부베보"],
  ["pa", "voiced", "ぱぴぷぺぽ", "パピプペポ", "pa pi pu pe po", "파피푸페포"],
] as const;

export const KANA_ROWS: readonly { key: string; group: "basic" | "voiced" }[] = ROWS.map(([key, group]) => ({
  key,
  group,
}));

function build(script: KanaScript): Kana[] {
  return ROWS.flatMap(([row, , hiragana, katakana, romaji, ko]) => {
    const chars = [...(script === "hiragana" ? hiragana : katakana)];
    const romajis = romaji.split(" ");
    const kos = [...ko];
    return chars.map((char, i) => ({ char, romaji: romajis[i], ko: kos[i], row }));
  });
}

// 청음 46자 + 탁음·반탁음 25자 = 71자. 요음은 MVP에서 제외한다
export const KANA: Record<KanaScript, readonly Kana[]> = {
  hiragana: build("hiragana"),
  katakana: build("katakana"),
};
