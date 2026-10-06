// 정식 출시 전에 법률 검토를 받는다 (spec 6-8)
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/site.config";

export const metadata: Metadata = { title: "개인정보처리방침 · Langrow" };

const H2 = "text-lead font-bold";
const P = "text-[15px]/[1.7]";
const LIST = `${P} list-disc pl-5`;

export default function PrivacyPage() {
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
          <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">개인정보처리방침</h1>
          <p className="text-micro text-ink-muted">시행일 {SITE.effectiveDate}</p>
        </div>

        <p className={P}>
          Langrow(운영자: {SITE.operatorName}, 이하 &ldquo;서비스&rdquo;)는 이용자의 개인정보를 아래와 같이 처리해요.
        </p>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>1. 수집하는 항목</h2>
          <ul className={LIST}>
            <li>Google 계정 정보: 이메일 주소, 이름, 프로필 사진 주소(Google 로그인 때 Google이 제공하는 정보)</li>
            <li>학습 기록: 학습 언어와 레벨, 학습한 단어와 결과, 레벨업 테스트 결과, 학습한 날짜와 연속 학습일, 체험 이용 기록</li>
            <li>대화 내용: 롤플레이 대화에서 입력한 문장, 응답·번역·교정, 대화 종료 피드백</li>
            <li>이용 기록: 하루 사용량 도달, Pro 버튼 클릭 같은 기능 이용 기록</li>
            <li>로그인 쿠키: 로그인 상태를 유지하기 위한 쿠키</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>2. 이용 목적</h2>
          <ul className={LIST}>
            <li>회원 식별과 로그인 상태 유지</li>
            <li>대화 응답·번역·교정·피드백 생성, 단어·레벨 관리 같은 학습 기능 제공</li>
            <li>하루 사용량 계산과 무료 체험 관리</li>
            <li>문의 응대와 서비스 개선을 위한 이용 통계</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>3. 보유 기간과 파기</h2>
          <p className={P}>
            개인정보는 회원 탈퇴 때까지 보관해요. 탈퇴하면 계정과 학습 기록, 대화 내용을 모두 삭제해요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>4. 회원 탈퇴와 삭제 요청</h2>
          <p className={P}>
            회원 탈퇴는 {SITE.contactEmail}로 요청해 주세요. 가입한 Google 계정 이메일로 보내 주시면 확인한 뒤 계정과
            학습 기록을 모두 삭제해요. 개인정보 열람·정정·삭제·처리 정지도 같은 주소로 요청할 수 있어요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>5. 개인정보의 국외 이전</h2>
          <p className={P}>대화 응답을 만들기 위해 대화 내용을 국외로 전송해요.</p>
          <ul className={LIST}>
            <li>이전받는 자: Anthropic, PBC</li>
            <li>이전 국가: 미국</li>
            <li>이전 항목: 대화에서 입력한 문장, 같은 대화의 이전 문장과 응답, 대화 상황과 학습 언어·레벨</li>
            <li>이전 목적: 대화 응답·번역·교정과 대화 종료 피드백 생성</li>
            <li>이전 시기와 방법: 대화 문장을 보내거나 대화를 끝낼 때마다 네트워크로 전송</li>
            <li>보유 기간: Anthropic의 API 데이터 보관 정책을 따라요</li>
          </ul>
          <p className={P}>
            이메일과 이름은 전송하지 않아요. 국외 이전에 동의하지 않으면 가입할 수 없어요. 가입한 뒤에는 대화 기능을
            쓰지 않으면 대화 내용이 전송되지 않아요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>6. 처리 위탁</h2>
          <ul className={LIST}>
            <li>Vercel Inc.: 웹 서비스 호스팅</li>
            <li>Supabase Inc.: 데이터베이스 운영과 로그인(인증)</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>7. 쿠키</h2>
          <p className={P}>
            로그인 상태를 유지하는 쿠키만 써요. 광고나 방문 분석 쿠키는 쓰지 않아요. 브라우저에서 쿠키를 막으면 로그인할
            수 없어요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>8. 만 14세 미만 아동</h2>
          <p className={P}>
            만 14세 미만은 가입할 수 없어요. 만 14세 미만의 개인정보가 수집된 사실을 알게 되면 바로 삭제해요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>9. 개인정보 보호책임자</h2>
          <ul className={LIST}>
            <li>이름: {SITE.operatorName}</li>
            <li>이메일: {SITE.contactEmail}</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={H2}>10. 방침의 변경</h2>
          <p className={P}>이 방침을 바꾸면 시행일과 바뀐 내용을 이 페이지에 게시해요.</p>
        </section>
      </main>
    </>
  );
}
