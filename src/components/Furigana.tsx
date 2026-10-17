import { Fragment } from "react";
import { parseFurigana, rubySegments } from "@/lib/furigana";

// HTML 문자열을 만들지 않고 React 요소로만 그린다. lang은 부모가 단다.
// show면 한자 표기와 가타카나 읽기를 <ruby>로 그린다. 본문을 inline-block 하나로 묶어 읽기가 본문보다 넓어도
// 본문 글자 사이가 벌어지지 않게 한다(ruby-align을 따르지 않는 브라우저 대비, spec/ui.md "타이포그래피")
export function Furigana({ text, show }: { text: string; show: boolean }) {
  return (
    <>
      {(show ? rubySegments(text) : parseFurigana(text)).map((segment, i) =>
        show && segment.reading !== undefined ? (
          <ruby key={i}>
            <span className="inline-block">{segment.text}</span>
            <rp>(</rp>
            <rt>{segment.reading}</rt>
            <rp>)</rp>
          </ruby>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
