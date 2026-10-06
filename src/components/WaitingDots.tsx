// AI 응답 대기·종료 처리 중·채점 중의 유일한 대기 표시다(스피너·스켈레톤 없음)
export function WaitingDots({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="size-1.75 rounded-full bg-ink-muted animate-dot"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}
