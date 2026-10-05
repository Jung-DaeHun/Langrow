# Step 2: lib-content

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 2장 "상황 목록", "레벨별 조절" 표와 후리가나 규칙
  - 3장 "단어 데이터" 표(`{{ }}` 예문, 일본어 후리가나 표기), "빈칸 채우기"
  - 3-1 "가나 익히기"
  - 7장 "`lib/` 단위 테스트"(furigana, blank), "데이터 검증"(가나, 상황)
- 이전 step 산출물: `src/lib/levels.ts`(Language, Level, showsFurigana), `src/lib/levelTest.ts`, `vitest.config.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/lib/`에 모듈 4개를 만든다. 모듈마다 같은 폴더에 `*.test.ts`를 먼저 쓴다. lib 공통 규칙(step 1과 같음): lib 밖 모듈·프레임워크 import 금지, 환경변수·`fetch`·현재 시각 읽기 금지.

### `furigana.ts`
```ts
export type FuriganaSegment = { text: string; reading?: string }
export function parseFurigana(input: string): FuriganaSegment[]
export function stripFurigana(input: string): string     // 읽기를 버리고 본문만 이은 문자열
```
- `[漢字|かんじ]`는 `{ text: '漢字', reading: 'かんじ' }`이다. 본문과 읽기는 둘 다 비어 있지 않아야 한다.
- 나머지 글자는 `{ text }`이고, 이웃한 일반 텍스트는 한 segment로 합친다.
- 깨진 표기(닫히지 않은 `[`, `|`가 없는 `[…]`, 빈 본문·읽기, 중첩된 `[`)는 그 부분의 `[`, `]`, `|`만 지우고 일반 텍스트로 둔다. 어떤 입력에도 throw하지 않는다.
- 단어 예문은 `{{ }}` 빈칸 표기와 섞여 있다(예: `[学校|がっこう]に{{[行|い]った}}。`). 호출하는 쪽이 `parseBlank`로 먼저 나눈 뒤 각 부분에 `parseFurigana`를 적용한다. 이 순서를 테스트로 보여 준다.
- HTML 문자열을 만들지 않는다. 그리기는 `3-ui`의 `Furigana` 컴포넌트가 `<ruby>` 요소로 한다.

### `blank.ts`
```ts
export type BlankParts = { before: string; answer: string; after: string }
export function parseBlank(example: string): BlankParts | null   // `{{…}}`가 정확히 1개이고 안이 비어 있지 않을 때만
export function buildOptions(answer: string, distractors: readonly string[], random?: () => number): string[]
export function isCorrectChoice(choice: string, answer: string): boolean   // === 비교, 정규화 없음
```
- `buildOptions`: 정답 + 오답 3개 = 4개를 섞는다(Fisher–Yates, 기본 `Math.random`). 테스트는 `random`을 주입해 결정적으로 검증한다.
- 정답 표기에 후리가나가 있으면(`[行|い]った`) 그 표기 문자열 그대로가 정답이다. 보기도 같은 표기를 쓴다.

### `kana.ts`
```ts
export type KanaScript = 'hiragana' | 'katakana'
export type Kana = { char: string; romaji: string; ko: string; row: string }
export const KANA_ROWS: readonly { key: string; group: 'basic' | 'voiced' }[]
export const KANA: Record<KanaScript, readonly Kana[]>
```
- 문자마다 각 71자: 청음 46자(`group: 'basic'`) + 탁음·반탁음 25자(`group: 'voiced'`). 요음은 넣지 않는다.
- 행 key: basic은 `a, ka, sa, ta, na, ha, ma, ya, ra, wa`(わ행에 わ·を·ん), voiced는 `ga, za, da, ba, pa`.
- romaji는 헵번식이다. 헷갈리는 글자는 이렇게 둔다: し shi 시, ち chi 치, つ tsu 츠, ふ fu 후, を wo 오, ん n 응, じ ji 지, ぢ ji 지, ず zu 즈, づ zu 즈. 가타카나도 같은 romaji·ko를 쓴다.
- 데이터 검증 테스트: 문자별 71자, 문자 안 `char` 중복 없음(romaji는 じ·ぢ=ji, ず·づ=zu처럼 겹쳐도 된다), basic 46·voiced 25, 히라가나와 가타카나의 romaji 순서가 같음, 모든 글자의 `row`가 `KANA_ROWS`에 있음.

### `scenarios.ts`
```ts
export type ScenarioLine = { text: string; ko: string }
export type Scenario = {
  id: string
  level: Level
  title: string          // 상황 목록 타일 제목
  goal: string           // 사용자 목표. 타일 설명으로도 쓴다
  roles: Record<Language, { role: string; opening: ScenarioLine }>
}
export const SCENARIOS: readonly Scenario[]
export function scenariosForLevel(level: Level): Scenario[]
export function findScenario(id: string): Scenario | undefined
```
아래 20개를 그대로 넣는다. `role`은 표의 "역할·배경"을 시스템 프롬프트에 넣을 한국어 1~2문장으로 다듬는다(AI가 누구이고 어디에 있으며 사용자와 어떤 관계인지).

| id | 레벨 | title | goal | en 역할·배경 | ja 역할·배경 |
|---|---|---|---|---|---|
| `l1-greeting` | 1 | 처음 만난 사람과 인사하기 | 이름과 출신을 말하고 상대에게도 물어봐요 | 미국 대학 기숙사 옆방 학생. 복도에서 처음 마주쳤다 | 일본 셰어하우스 주민. 새로 이사 온 사용자를 거실에서 처음 만났다 |
| `l1-cafe` | 1 | 카페에서 음료 주문하기 | 마실 음료와 크기를 말하고 주문을 마쳐요 | 미국 동네 카페의 바리스타 | 일본 카페의 점원 |
| `l1-checkout` | 1 | 편의점에서 계산하기 | 봉투나 결제 방법을 묻는 말에 답하고 계산을 마쳐요 | 미국 편의점 계산원 | 일본 편의점 점원. 도시락을 데울지, 봉투가 필요한지 묻는다 |
| `l1-directions` | 1 | 길 물어보기 | 가고 싶은 곳을 말하고 가는 방법을 알아들어요 | 뉴욕 거리에서 헤매는 사용자에게 먼저 말을 건 친절한 행인 | 도쿄 역 앞에서 헤매는 사용자에게 먼저 말을 건 친절한 행인 |
| `l2-restaurant` | 2 | 식당에서 주문하기 | 인원수를 말하고 메뉴를 추천받아 주문해요 | 미국 캐주얼 레스토랑의 서버 | 일본 정식집(定食屋)의 점원 |
| `l2-hotel` | 2 | 호텔 체크인하기 | 예약자 이름을 말하고 체크인과 조식 시간을 확인해요 | 미국 호텔 프런트 직원 | 일본 비즈니스호텔 프런트 직원 |
| `l2-clothes` | 2 | 옷 가게에서 사이즈 찾기 | 원하는 옷의 사이즈와 색을 묻고 입어 봐도 되는지 물어요 | 미국 의류 매장 점원 | 일본 의류 매장 점원 |
| `l2-train` | 2 | 기차표 사기 | 목적지와 시간을 말하고 표를 산 뒤 타는 곳을 확인해요 | 미국 장거리 기차역 매표 창구 직원 | 일본 기차역 매표 창구 직원 |
| `l3-pharmacy` | 3 | 약국에서 증상 설명하기 | 증상을 설명하고 알맞은 약과 먹는 방법을 물어요 | 미국 약국의 약사 | 일본 드러그스토어의 약사 |
| `l3-weekend` | 3 | 동료와 주말 이야기하기 | 주말에 한 일을 이야기하고 상대 이야기에 반응해요 | 미국 회사 동료. 월요일 아침 탕비실에서 만났다 | 일본 회사 동료. 월요일 점심시간에 같은 테이블에 앉았다 |
| `l3-return` | 3 | 산 물건 교환·환불하기 | 문제를 설명하고 교환이나 환불을 요청해요 | 미국 전자제품 매장 고객 서비스 데스크 직원 | 일본 가전제품 매장 서비스 카운터 직원 |
| `l3-reservation` | 3 | 전화로 식당 예약하기 | 날짜·시간·인원을 정하고 요청 사항을 전해요 | 미국 레스토랑에서 예약 전화를 받은 직원 | 일본 이자카야에서 예약 전화를 받은 직원 |
| `l4-interview` | 4 | 면접 보기 | 자기소개를 하고 경험과 강점을 구체적인 예로 설명해요 | 미국 IT 기업의 채용 면접관 | 일본 기업의 채용 면접관. 면접 예절과 경어를 지킨다 |
| `l4-meeting` | 4 | 회의에서 의견 말하기 | 의견을 말하고 반대 의견에 근거를 들어 답해요 | 팀 회의에서 신규 기능 일정을 2주 당기자고 제안한 미국인 팀장 | 팀 회의에서 신규 기능 일정을 2주 당기자고 제안한 일본인 과장 |
| `l4-repair` | 4 | 집 수리 요청하기 | 고장 상황을 설명하고 수리 일정을 조율해요 | 미국 아파트 관리 사무소 직원 | 일본 임대 아파트 관리회사 담당자 |
| `l4-support` | 4 | 고객센터에 문제 해결 요청하기 | 상황을 설명하고 원하는 해결 방법을 분명히 요구해요 | 미국 인터넷 통신사 고객센터 상담원. 이중 청구 문의를 받았다 | 일본 택배 회사 고객센터 상담원. 배송 지연 문의를 받았다 |
| `l5-salary` | 5 | 연봉 협상하기 | 근거를 들어 원하는 조건을 제시하고 절충안을 찾아요 | 미국 회사의 인사 담당 매니저. 예산이 빠듯하다 | 일본 회사의 인사부장. 예산이 빠듯하다 |
| `l5-qa` | 5 | 발표 후 질문에 답하기 | 날카로운 질문에 논리적으로 답하고 부족한 점은 인정해요 | 업계 콘퍼런스에서 사용자의 발표를 듣고 질문하는 미국인 전문가 | 사내 발표를 듣고 질문하는 일본인 부장 |
| `l5-debate` | 5 | 재택근무 찬반 토론하기 | 입장을 밝히고 상대의 반론에 근거를 들어 다시 반박해요 | 디너 파티에서 재택근무에 반대하는 미국인 친구 | 회식 자리에서 재택근무에 반대하는 일본인 선배 |
| `l5-apology` | 5 | 거래처에 사과하고 수습하기 | 실수를 격식 있게 사과하고 구체적인 해결책을 제안해요 | 납품 지연으로 화가 난 미국 거래처 담당자 | 납품 지연으로 화가 난 일본 거래처 담당자. 사용자에게 격식 있는 경어를 기대한다 |

**첫 마디(`opening`) 40개는 직접 쓴다.** 규칙:
- `opening.text`: AI가 역할로서 먼저 건네는 첫 대사(학습 언어). 사용자가 목표를 향해 첫 마디를 할 수 있게 질문이나 권유로 끝낸다.
- 길이: 레벨 1~2는 짧은 1문장, 레벨 3은 1~2문장, 레벨 4~5는 2~3문장까지. 어휘와 문형은 spec 2장 "레벨별 조절" 표를 따른다.
- 일본어는 레벨과 무관하게 **모든 한자**에 `[漢字|かな]` 표기를 단다. 화면에 보일지는 `showsFurigana(level)`가 정한다. 경어 수준은 역할에 맞춘다.
- `opening.ko`: 자연스러운 한국어 번역.
- 실존 회사·브랜드·인물 이름을 쓰지 않는다.

데이터 검증 테스트: 20개, 레벨마다 4개, id 중복 없음, 모든 상황에 en·ja의 `role`·`opening.text`·`opening.ko`가 비어 있지 않음, 일본어 `opening.text`의 후리가나 표기가 온전함(`parseFurigana` 결과의 일반 텍스트 segment에 `[`, `]`, `|`도 한자(`/\p{Script=Han}/u`)도 남지 않음. 즉 모든 한자에 읽기가 달려 있음), `findScenario`·`scenariosForLevel` 동작.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
# lib 순수성 (step 1과 같음)
! grep -rnE "from ['\"](@/|\.\./)(app|server|services|components)" src/lib
! grep -rnE "from ['\"](next|react|@supabase|@anthropic-ai)" src/lib
! grep -rnE "process\.env|fetch\(|Date\.now\(\)|new Date\(\)" src/lib --include=*.ts --exclude=*.test.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (상황 `src/lib/scenarios.ts`, 가나 `src/lib/kana.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (HTML 문자열 생성 금지)
3. 결과에 따라 `phases/0-foundation/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (모듈 4개와 핵심 export, "상황 첫 마디 40개는 AI 초안이라 출시 전 사람 검수 필요"를 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 상황의 id·레벨·title·goal을 표와 다르게 바꾸지 마라. 이유: 사용자와 확정한 목록이다. 역할 문장은 다듬어도 되지만 배경(나라, 장소, 관계)은 바꾸지 마라.
- 후리가나를 HTML 문자열로 만들지 마라. 이유: CLAUDE.md CRITICAL(`dangerouslySetInnerHTML` 금지). 파싱 결과만 돌려준다.
- 빈칸 정답 비교에 정규화(공백 제거, 대소문자, 후리가나 제거)를 넣지 마라. 이유: spec S2. 4지선다라 문자열 그대로 비교한다.
- 가나에 요음·진행도 저장을 넣지 마라. 이유: spec 3-1 MVP 제외.
- step 1 모듈의 기존 export를 바꾸지 마라. 이유: 이미 다른 모듈과 테스트가 기대는 계약이다.
- 기존 테스트를 깨뜨리지 마라
