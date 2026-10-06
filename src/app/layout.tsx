import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

// 일본어 학습 텍스트(:lang(ja))에만 쓴다. 필요할 때만 내려받게 preload하지 않는다
const notoSansJp = Noto_Sans_JP({ weight: ["400", "500", "700"], preload: false, variable: "--font-noto-sans-jp" });

export const metadata: Metadata = {
  title: "Langrow",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={notoSansJp.variable}>
      <body>{children}</body>
    </html>
  );
}
