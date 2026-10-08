// 정식 출시 전에 법률 검토를 받는다 (spec/ops.md "출시 최소 요건")
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_LIMITS, PRO_PRICE_KRW, TRIAL_DAYS } from "@/lib/plan";
import { SITE } from "@/site.config";

export const metadata: Metadata = { title: "이용약관 · Langrow" };

const H2 = "text-lead font-bold";
const P = "text-[15px]/[1.7]";
const LIST = `${P} list-disc pl-5`;

export default function TermsPage() {
  const { free, pro } = PLAN_LIMITS;

  return (
    <>
      <header className="sticky top-0 z-10 bg-card shadow-nav">
        <div className="mx-auto flex h-14 max-w-prose-doc items-center gap-3 px-4 md:px-10">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            돌아가기
          </Link>
          <p className="text-h3 font-extrabold tracking-[-0.03em] text-brand">Langrow</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-prose-doc flex-col gap-8 px-4 py-10 md:px-10 md:py-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">이용약관</h1>
          <p className="text-micro text-ink-muted">시행일 {SITE.effectiveDate}</p>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>1. 서비스 내용</h2>
          <p className={P}>
            Langrow(운영자: {SITE.operatorName}, 이하 &ldquo;서비스&rdquo;)는 한국인 학습자를 위한 영어·일본어 학습
            서비스예요. 상황 롤플레이 대화(번역·교정·종료 피드백), 단어 학습(플래시카드·빈칸 문제), 레벨업 테스트, 가나
            익히기를 제공해요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>2. 가입</h2>
          <p className={P}>
            만 14세 이상만 가입할 수 있어요. Google 계정으로 로그인한 뒤 이 약관과 개인정보처리방침(국외 이전 포함)에
            동의하면 가입이 끝나요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>3. Free와 Pro</h2>
          <ul className={LIST}>
            <li>
              Free: 하루 대화 {free.chatTurns}턴, 새 단어 {free.newWords}개까지 무료로 쓸 수 있어요.
            </li>
            <li>
              Pro: 하루 대화 {pro.chatTurns}턴, 새 단어 {pro.newWords}개까지 쓸 수 있어요. 표시 가격은 월{" "}
              {PRO_PRICE_KRW.toLocaleString("ko-KR")}원이에요. 지금은 결제 기능이 없어요.
            </li>
            <li>하루 사용량은 영어·일본어를 합산해 계정 단위로 세고, 한국 시간 자정에 다시 채워져요.</li>
            <li>복습, 레벨업 테스트, 가나 익히기, 대화 종료 피드백은 사용량에 포함되지 않아요.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>4. {TRIAL_DAYS}일 무료 체험</h2>
          <ul className={LIST}>
            <li>계정당 한 번, {TRIAL_DAYS}일 동안 Pro 사용량을 쓸 수 있어요.</li>
            <li>결제 정보를 받지 않아요. 체험이 끝나면 Free로 돌아가고, 자동 결제는 없어요.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>5. 학습용 응답의 한계</h2>
          <p className={P}>
            대화 응답·번역·교정·피드백은 자동으로 만들어져 틀릴 수 있어요. 시험이나 업무처럼 정확성이 중요한 곳에 쓸
            때는 다른 자료로 한 번 더 확인해 주세요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>6. 금지 행위</h2>
          <ul className={LIST}>
            <li>다른 사람의 계정을 쓰거나 계정을 다른 사람과 나눠 쓰는 행위</li>
            <li>자동화된 요청 등으로 하루 사용량 제한을 피하거나 서비스 운영을 방해하는 행위</li>
            <li>대화에 다른 사람의 개인정보나 불법·유해한 내용을 입력하는 행위</li>
          </ul>
          <p className={P}>금지 행위가 확인되면 서비스 이용을 제한할 수 있어요.</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>7. 회원 탈퇴</h2>
          <p className={P}>
            회원 탈퇴는 {SITE.contactEmail}로 요청해 주세요. 탈퇴하면 학습 기록과 대화 내용이 모두 삭제되고 되돌릴 수
            없어요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>8. 약관의 변경</h2>
          <p className={P}>약관을 바꾸면 시행일과 바뀐 내용을 이 페이지에 게시해요.</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>9. 문의</h2>
          <p className={P}>서비스 이용 문의는 {SITE.contactEmail}로 보내 주세요.</p>
        </section>
      </main>
    </>
  );
}
