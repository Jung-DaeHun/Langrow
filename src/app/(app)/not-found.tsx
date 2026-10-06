import Link from "next/link";

// 셸 안에서 notFound()를 부른 경우(없거나 남의 리소스)
export default function AppNotFound() {
  return (
    <section className="flex flex-col gap-6 pt-10 animate-enter">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">페이지를 찾을 수 없어요</h1>
        <p className="text-ink-muted">주소를 다시 확인하거나 홈에서 시작해 보세요.</p>
      </div>
      <div>
        <Link
          href="/home"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 font-semibold text-white transition duration-200 hover:bg-brand active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          홈으로
        </Link>
      </div>
    </section>
  );
}
