# 테스트

## TDD hook에 맞춘 파일 규칙

- TDD guard(`scripts/hooks/tdd-guard.sh`)는 예외(설정·타입·`page`/`layout` 등 Next 파일, 경로에 `test`/`spec`이 들어간 파일)를 뺀 **모든 `.ts(x)`**에 테스트 파일을 요구한다. `route.ts`, 미들웨어, 컴포넌트, use-case, `server/db/*.ts`뿐 아니라 `lib/`, `services/`, `scripts/`도 대상이다. 같은 폴더에 `*.test.ts(x)`를 먼저 만든다.
- `services/supabase/*.ts`와 `services/env.ts`는 env가 없어도 import만으로 throw하지 않고, 호출할 때 검증 에러가 나는지 테스트한다 (Stop hook의 `next build` 안전성).
- `scripts/*.ts`는 입출력을 주입받는 `main(deps)`를 export하고 가짜 deps로 테스트한다 (generate-words: 가짜 AI 응답 → 검증된 JSON, seed-words: JSON → upsert 행, metrics-report: 행 → 분자/분모 출력). 계산 규칙은 `lib/`에 둔다.
- guard는 경로에 `test`가 들어간 파일을 검사하지 않는다. 그래서 레벨업 테스트의 경로는 `/level-up`, `/api/level-up`으로 둔다. `src/test/fakes.ts` 같은 테스트 보조 파일은 이 규칙 덕분에 통과한다.
- DB 접근 파일의 `server/db/*.test.ts`는 실제 DB 통합 테스트로 작성한다. Vitest 기본 실행에서 이 경로를 제외하고 `test:db`에서 포함한다. Supabase 쿼리 체인을 mock하거나 hook 통과만을 위한 빈 테스트를 만들지 않는다.
- 정적 UI는 `page.tsx`/`layout.tsx`에 둔다 (hook이 검사하지 않음). 컴포넌트는 꼭 필요한 것만 만든다.
  - 화면 단위: `OnboardingFlow`, `ScenarioPicker`, `ChatRoom`, `ChatFeedback`, `WordSession`, `LevelTestRunner`, `KanaDeck`
  - 공용: `Flashcard`, `BlankQuiz`, `Furigana`, `LanguageSheet`(상단 언어·레벨 메뉴), `AppNav`, `UsageCard`, `Dialog`, `Toast`, `WaitingDots`, `GoogleLoginButton`, `TrialButton`(체험 시작), `ProButton`(Pro 클릭·준비 중 모달), `LimitNotice`(한도 도달 안내), `LogoutButton`. 만든 이유는 `ui.md` "공용 React 컴포넌트와 이유"에 있다
  - 입력·API 호출이 있는 부분만 Client Component로 만든다. 페이지의 분기 규칙은 테스트할 수 있게 `lib/`(예: `today`, `readiness`, `onboarding`)에 둔다.
  - 페이지 읽기는 `server/db/reads.ts`에 두고 `test:db`로 실제 RLS와 함께 검증한다. 운영자 정보는 설정 파일 `src/site.config.ts`에 둔다.
- Vitest 설정에서 `server-only`를 빈 모듈로 alias한다.

## 테스트 목록 (TDD, Vitest)

- **`lib/` 단위 테스트**
  - plan: Pro 여부, 한도, 체험 가능 여부
  - usage: 한국 시간 자정 경계, 예약일과 성공일이 다른 턴
  - streak: 오늘/어제/그 외 갱신 규칙, 표시 규칙
  - furigana: 파싱, 깨진 표기는 일반 텍스트로
  - blank: `{{ }}` 파싱, 정답 추출, 보기 섞기, 정답 판정
  - text: 글자 수
  - wordBatch: 회차 크기(남은 단어 0/1~9 포함), known/review 결정, 신규분 계산
  - levelTest: 20개 검증, 16/20 경계
  - levels: 후리가나·번역·한국어 입력·레벨업·가나 표시 경계 / today: 목표 진행·소진·남은 할 일 수 / readiness: 요구 수준별 동의·레벨 판정 / errors: 코드별 HTTP 상태
  - metrics: D1/D7 한국 날짜, 관찰 완료 분모, 운영 계정 제외, 최소 표본 미달 판단 보류, 유효한 세션(성공 턴 3개 이상, 종료 여부 무관), 한도 도달 `feature`별 분리, Pro 관심은 경로 무관 체험 시작자
- **services**: 프롬프트 빌더, 응답 스키마, 재시도 1번과 호출 예산, refusal과 `max_tokens`는 실패로 처리
- **use-case** (가짜 db와 ai 주입; 실제 경합 증명은 아래 DB 통합 테스트)
  - 대화: 정상, 한도·20턴·실패 10회 차단, 예약 거부 시 AI 미호출, 실패 확정 후 예약 반환, 만료·교체된 토큰의 결과 폐기
  - `/end`: 0턴 skipped, 이미 종료된 결과 재사용, 처리 중 202, 턴 진행 중 409, AI 실패/실패 한도 시 fallback, DB 확정 재시도 시 AI 미호출
  - 보안: 남의 세션 404, 미동의·미온보딩 API 403와 AI/학습 변경 없음, 초기 설정 API 예외
  - 레벨: API로 올리기는 거부, 합격 시에만 +1, 도중에 레벨이 바뀌면 409, 첫 완료 시각 유지
  - 체험: 두 번째 요청 거부
  - 단어: 한도 0에서 기존 10개 재전송 성공, 기존+신규 혼합은 신규만 검사, 초과 신규분 전부 거부, 전부 중복이면 다음 날에도 활동일·연속일 변경 없음
  - 학습: 복습·가나·테스트만 한 날도 활동일 기록
  - 지표: 한도를 채우는 마지막 성공 저장에도 limit_reached 기록, 초과 요청 없이도 체험 전환 분모에 포함, 단어 재전송은 이벤트 추가 없음
- **DB 통합 테스트 (`npm run test:db`, 로컬 Supabase)**
  - supabase-js로 RPC를 호출한다. RPC는 커밋한 뒤 응답하므로 요청 순서는 순차 호출로, 동시 실행은 `Promise.all`(요청마다 별도 연결·트랜잭션)로 만든다. 처리 기한 만료는 `operation_expires_at`을 과거로 바꿔 재현한다. AI 호출 단계는 예약 RPC와 확정 RPC 사이의 간격으로 대신하며 외부 AI를 부르지 않는다.
  - A의 pending 커밋 후 완료 전에 B가 같은 세션으로 전송: B는 409, pending은 정확히 1개. turn_no UNIQUE만으로 통과하는 테스트를 만들지 않는다.
  - 같은 계정의 다른 세션에서 한도 1회 남기고 동시 예약: 하나만 허용
  - 턴 예약과 종료가 경합: 먼저 예약한 상태에 따라 다른 요청은 거부. 동시 종료는 작업 하나만 예약
  - pending 만료 복구·ending 만료 fallback·늦게 도착한 성공/실패가 새 작업과 종료 결과를 변경하지 않음
  - 실패 확정과 복구 동시 실행 시 예약 반환·실패 이벤트가 한 번만 반영됨
  - 서로 다른 단어 묶음·두 언어의 회차 동시 저장: 총 신규분이 한도를 넘지 않음. 같은 회차 동시 재전송은 한 번만 삽입
  - 같은 날 학습 동시 저장에서 활동일 행은 하나만 남음, 결과 저장과 활동일·연속일 갱신의 동시 커밋·롤백
  - anon/authenticated의 쓰기·RPC 호출 거부, 타인 행 RLS 읽기 거부, service_role RPC에서도 타인 세션 변경 거부
- **route / 페이지 접근**
  - `route()` 래퍼: 401, 403, 400, 에러 매핑, 500, JSON이 아닌 요청 거부, 202 정상 처리
  - 미들웨어: 비로그인 `/`, `/privacy`, `/terms`, 콜백은 통과, `/home`은 이동, `/api/**`는 리디렉션하지 않음, 정적 파일 제외
  - 페이지 준비 상태: 미동의 사용자의 보호 페이지 → 온보딩, 온보딩·공개 페이지에서 이동 루프 없음
  - 각 `route.test.ts`는 연결과 해당 경로 준비 상태 확인
- **컴포넌트**
  - `Furigana`의 HTML 비주입·깨진 표기 처리, 대화 입력의 IME Enter
  - 종료 202 표시·재확인·fallback에서 저장된 턴 교정 확인
  - 레벨 1~4/5 단어 소진 분기, 오답 0개, 소진 뒤 미완료 10개 목표/잘못된 체험 유도 없음, 레벨·언어 변경 후 일반 화면 복귀
  - 대화 입력은 표시된 남은 횟수가 0이어도 막지 않고 429 응답 뒤에만 막음
- **데이터 검증**
  - 단어: 언어 × 레벨 개수, 예문마다 `{{ }}` 정확히 1개, 오답 보기 3개가 서로 다르고 정답과도 다름
  - 가나: 각 71자, 중복 없음
  - 상황: 20개, en·ja 모두 AI 역할·배경, 첫 마디와 번역이 있음
- **수동 E2E**: 공개 페이지 → 로그인 → 동의 → 온보딩 → 가나 → 대화와 종료 → 단어/복습 → 레벨업 → 한도 도달 → 체험 → 재시작 거부. 추가로 두 탭 전송·전송 중 종료·단어 저장 응답 유실·레벨 5 소진·방문만 한 날·일본어 IME·비로그인 보호 페이지를 확인한다.
- **배포 전 보안 점검**
  - Security Advisor 경고 0개, 모든 사용자 테이블 RLS 켜짐
  - 빌드 결과물에 secret key 문자열이 없음, `.env*`가 git에 없음
  - 남의 세션 ID 요청은 404, 미동의/레벨 미설정 API는 403
  - RPC 실행 권한 회수 및 `test:db` 통과
