# Step 0: audio-core

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-12-tts-audio.md`: "Global Constraints", "Review Focus", "### Task 1: 음성 경로·SSML·브라우저 음성 고르기", "### Task 2: 음성 생성 스크립트" 전체. **이 step은 Task 1과 Task 2만 한다.**
- `docs/spec/audio.md`
  - "미리 만드는 음성"의 "파일", "읽을 내용", "생성 스크립트", "어긋남 검사"
  - "대화 음성"의 음성 고르기 문장(`pickVoice`의 규칙)
- `docs/spec/testing.md`의 `lib/` 단위 테스트 "audio" 항목과 "음성 생성 스크립트" 항목
- 기존 코드:
  - `src/lib/furigana.ts`(`parseFurigana`), `src/lib/kana.ts`(`KANA`), `src/lib/levels.ts`(`Language`), `src/lib/words.ts`(`WordEntry`)
  - `scripts/seed-words.ts`와 `scripts/seed-words.test.ts`(`main(deps)`·가짜 deps·`import.meta.url` 실행 가드 모양)
  - `src/test/wordFiles.ts`(`validWord`)
  - `package.json`의 `scripts`, `CLAUDE.md`의 "## 명령어"

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

단어·예문·가나 음성은 로컬 스크립트가 Azure Speech 무료 등급(F0)으로 미리 만들어 `public/audio/female/`에 커밋한다. 대화 문장은 브라우저 음성으로 읽는다. 이 step은 그 바탕을 만든다.

- `src/lib/audio.ts`: 순수 함수. 파일 경로, SSML 본문·문서, 만들 음성 목록, 브라우저 음성 고르기
- `scripts/generate-audio.ts`: Azure REST를 부르는 생성 스크립트와 `npm run audio:generate`

실제 생성(약 4,071개, 약 3.4시간)은 이 phase에서 하지 않는다. 다음에 사람이 확인하며 돌린다.

계획 Task 1·2에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 1의 Step 1~4, Task 2의 Step 1~5를 순서대로 한다. **Task 2의 Step 6(실제 Azure로 두 개 만들어 보기)과 두 Task의 Commit 단계는 하지 마라.** 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

만들 인터페이스:

```ts
// src/lib/audio.ts (순수 함수)
export const SLOW_RATE = 0.75
export const SPEECH_LOCALE: Record<Language, string>  // { en: "en-US", ja: "ja-JP" }
export function wordAudioPath(wordId: string): string     // "/audio/female/words/{id}.mp3"
export function exampleAudioPath(wordId: string): string  // "/audio/female/words/{id}-ex.mp3"
export function kanaAudioPath(char: string): string       // "/audio/female/kana/{히라가나 코드포인트 16진수 소문자}.mp3"
export function escapeXml(text: string): string
export type SpeechWord = { id: string; language: Language; word: string; reading: string | null; example: string }
export function wordSpeech(w: SpeechWord): string
export function exampleSpeech(w: SpeechWord): string
export function ssmlDocument(language: Language, voiceName: string, body: string): string
export type AudioItem = { path: string; source: string; language: Language; body: string }
export function audioItems(words: readonly SpeechWord[]): AudioItem[]
export function pickVoice<T extends { lang: string }>(voices: readonly T[], language: Language): T | null

// scripts/generate-audio.ts
export const MANIFEST_PATH = "data/audio-manifest.json"
export const AZURE_VOICES: Record<Language, string>  // { en: "en-US-AvaNeural", ja: "ja-JP-NanamiNeural" }
export type Manifest = Record<string, string>
export type PlannedAudio = { path: string; source: string; ssml: string; hash: string }
export function ssmlHash(ssml: string): string
export function plannedAudio(words: readonly WordEntry[]): PlannedAudio[]
export function readWordFiles(dir?: string): Promise<WordEntry[]>
export type GenerateAudioDeps = { args; env: { key; region }; readWords; readManifest; writeManifest; audioExists; writeAudio; fetch; sleep; log }
export function main(deps: GenerateAudioDeps): Promise<number>
```

### 지켜야 할 핵심 규칙

- **경로**: 첫 폴더는 음성 종류이고 지금은 `female`만 쓴다(나중에 `male`을 같은 구조로 추가한다). 가타카나는 코드포인트에서 0x60을 뺀 히라가나 파일을 쓴다(가나 파일은 71개).
- **SSML 본문**
  - 모든 글자를 XML 이스케이프한다(`&`·`<`·`>`·`"`·`'`).
  - 영어 단어는 그대로, 영어 예문은 `{{`·`}}`만 지운다.
  - 일본어 단어는 한자가 있고 `reading`이 다를 때만 `<sub alias="{reading}">{word}</sub>`로 쓴다.
  - 일본어 예문은 `{{`·`}}`를 지우고 `parseFurigana`의 읽기가 있는 조각을 `<sub alias="읽기">본문</sub>`으로 바꾼다.
  - 가나는 히라가나 글자 하나다.
- **음성 이름은 스크립트 상수(`AZURE_VOICES`)에 둔다.** `lib/audio`는 Azure 음성 이름을 모른다. 해시는 음성 이름이 들어간 SSML 문서 전체의 sha256 앞 16자다. 그래서 음성을 바꾸면 전부 다시 만든다.
- **생성 흐름** (spec `audio.md` "생성 스크립트")
  - 키·지역이 없으면 fetch 없이 실패(1)한다. 모르는 옵션이면 사용법을 출력하고 1을 돌려준다.
  - manifest 해시가 같고 파일이 있으면 건너뛴다. 해시가 다르거나 파일이 없으면 다시 만든다.
  - 요청 사이를 3초 이상 띄운다. 첫 요청 전에는 기다리지 않는다.
  - 429는 `Retry-After`초(없으면 60초) 기다렸다가 같은 항목을 다시 보낸다. 5번 이어지면 멈춘다.
  - 그 밖의 오류 응답이나 빈 응답이면 그 자리에서 멈춘다(1). 이미 쓴 파일과 manifest는 남긴다.
  - 파일 하나를 쓸 때마다 manifest를 쓴다(키 순서를 정렬해 diff를 작게).
  - `--ids a,b`는 `source`(단어 ID 또는 가나 글자)가 맞는 항목만 만든다. 맞는 게 없으면 1이다.
  - 요청: `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`, 헤더 `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`
- **환경변수**: 스크립트의 실제 deps만 `process.env.AZURE_SPEECH_KEY`·`AZURE_SPEECH_REGION`을 읽는다. 키 값을 로그에 남기지 않는다.
- `package.json`에 `"audio:generate": "tsx --env-file-if-exists=.env.local scripts/generate-audio.ts"`, `CLAUDE.md` "## 명령어"에 계획 Task 2 Step 5의 한 줄을 더한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q '"audio:generate"' package.json
grep -q "npm run audio:generate" CLAUDE.md
test ! -e public/audio && test ! -e data/audio-manifest.json   # 실제 생성을 하지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/`는 순수 함수, `scripts/*.ts`는 `main(deps)`를 export)
   - ADR 기술 스택을 벗어나지 않았는가? (Azure SDK를 설치하지 않고 `fetch`로 REST를 부른다, ADR-014)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (secret에 `NEXT_PUBLIC_` 없음, 구현 경로에 `test` 문자열 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `audio.md` "미리 만드는 음성"의 "파일"·"읽을 내용"·"생성 스크립트"와 "대화 음성"의 음성 고르기 문장이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/5-tts/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(만든 파일, `lib/audio`의 export 이름, 스크립트 옵션). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `npm run audio:generate`를 실행하거나 Azure를 실제로 부르지 마라(계획 Task 2 Step 6 포함). 이유: 생성은 다음에 사람이 확인하며 돌린다. step 커밋은 `git add -A`라서 만든 mp3와 manifest가 그대로 커밋되고, 무료 한도를 쓴다.
- 계획 Task 3의 "커밋된 음성 파일" 어긋남 검사 테스트를 넣지 마라. 이유: 음성 파일이 아직 없어서 테스트가 실패하고 Stop hook이 깨진다. 생성할 때 같이 넣는다.
- Azure 키를 `src/services/env.ts`에 넣거나 `NEXT_PUBLIC_`을 붙이지 마라. 이유: 키는 로컬 생성 스크립트 전용이고 운영 앱은 Azure를 부르지 않는다(spec `audio.md`).
- `src/lib/audio.ts`에서 파일·환경변수·fetch·`node:crypto`를 쓰지 마라. 이유: `lib/`는 순수 함수만 둔다(CLAUDE.md). 해시는 스크립트에서 계산한다.
- Azure Speech SDK 등 새 의존성을 설치하지 마라. 이유: REST 한 번 호출이면 되고 ADR-014가 `fetch`로 정했다.
- 컴포넌트·페이지·`proxy.ts`를 고치지 마라. 이유: step 1·2의 범위다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
