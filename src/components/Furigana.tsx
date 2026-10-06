import { Fragment } from "react";
import { parseFurigana } from "@/lib/furigana";

// HTML 문자열을 만들지 않고 React 요소로만 그린다. lang은 부모가 단다
export function Furigana({ text, show }: { text: string; show: boolean }) {
  return (
    <>
      {parseFurigana(text).map((segment, i) =>
        show && segment.reading !== undefined ? (
          <ruby key={i}>
            {segment.text}
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
