export const meta = {
  name: 'review-code-run',
  description: '/review-code가 부르는 4차원 병렬 리뷰와 지적마다 검증자 3명(2/3 다수결)',
  whenToUse: '직접 실행하지 않는다. /review-code가 변경 범위와 문서를 모아 args로 넘겨 부른다.',
  phases: [
    { title: 'Review', detail: '차원 4개 병렬 리뷰' },
    { title: 'Verify', detail: '지적마다 검증자 3명, 2/3 다수결' },
    { title: 'Tidy', detail: '잘된 점 합치기, 같은 문제 지적 묶기' },
  ],
}

// 앞일수록 심하다
const SEVERITIES = ['critical', 'major', 'minor', 'nit']
const ICON = { critical: '🔴', major: '🟠', minor: '🟡', nit: '⚪' }
const NAME = { critical: 'Critical', major: 'Major', minor: 'Minor', nit: 'Nit' }
const VOTERS = 3

const SEVERITY_GUIDE = [
  '심각도 기준:',
  '- critical: 병합하면 사고. 남의 데이터 접근, secret 노출, XSS, 데이터 손상·유실, 주요 흐름(로그인·대화·단어 학습)이 깨짐',
  '- major: 실제로 일어나는 상황에서 틀린 동작. 사용자에게 보이는 spec 불일치, 보안 영향이 없는 CRITICAL 규칙 위반, 레이어 위반',
  '- minor: 드문 경계 상황, 실제 유지보수 비용이 드는 문제, 요약 문서 동기화 누락',
  '- nit: 이름, 표현, 작은 정리. 고치지 않아도 된다',
].join('\n')

const COMMON_RULES = [
  '규칙:',
  '- 읽기 전용이다. 파일을 고치지 않는다. Bash는 git diff, git log, git show처럼 읽는 명령만 쓴다.',
  '- 변경은 "git diff <base> -- <파일>"로 본다. 상태가 ??인 파일은 커밋 안 한 새 파일이라 git diff에 나오지 않으니 파일을 직접 읽는다.',
  '- 변경된 줄이나 변경 때문에 생긴 문제만 보고한다. 원래 있던 문제는 보고하지 않는다.',
  '- lint, build, test, TDD guard가 잡는 것은 보고하지 않는다.',
  '- file은 저장소 루트 기준 경로(/ 구분), line은 변경 후 파일의 줄 번호다. 추측이면 보고하지 않는다.',
  '- 지적이 없으면 findings는 빈 배열이다. 개수를 채우려고 만들지 않는다.',
  '- 다른 차원의 영역은 보고하지 않는다.',
  '- strengths(잘된 점)는 최대 2개다.',
  '- 가드레일 문서 중 이 차원에 필요한 것만 읽는다.',
  '- title은 한 줄 제목, tldr은 무엇이 왜 문제인지 한 줄, good은 이 코드가 어떻게 동작해야 하는지(규칙·기대 동작), fix는 그렇게 만드는 코드나 수정 방법이다.',
].join('\n')

// 차원을 추가하려면 여기에 { key, prompt } 하나를 넣는다
const DIMENSIONS = [
  {
    key: 'correctness',
    prompt: '로직 오류, 경계값, 예외·에러 흐름, 비동기 경쟁(await 누락 포함), null 처리, 상태 전이.',
  },
  {
    key: 'security',
    prompt:
      'admin(secret key) 클라이언트로 하는 조회·변경에 user_id를 거는지, 남의 리소스는 404인지, 사용자 ID를 getUser()로 얻는지(body의 userId 금지), secret에 NEXT_PUBLIC_이 붙지 않았는지, admin 클라이언트가 server-only로 막혀 있는지, dangerouslySetInnerHTML, RPC·RLS 권한(security definer, grant), 클라이언트가 보낸 날짜·플랜·사용량을 믿는지, 로그에 개인정보·secret이 남는지. user_id 규칙은 CLAUDE.md에서 아키텍처 규칙에 있지만 이 차원이 맡는다.',
  },
  {
    key: 'architecture',
    prompt:
      '쓰기와 Claude 호출이 src/app/api/**/route.ts → src/server/ use-case에서만 일어나는지, 페이지(Server Components)는 읽기만 하는지, 의존 방향 app → server → services·lib, src/lib/는 순수 함수인지(I/O·환경변수·fetch 없음), 여러 행의 판정·변경이 RPC 한 번이고 쓰기 RPC가 먼저 profiles FOR UPDATE를 잡는지, Claude 호출 중 DB 잠금을 잡지 않는지, 날짜·플랜·한도를 RPC 안의 DB 시각으로 판정하는지, 구현 파일 경로에 test 문자열이 없는지. user_id 규칙은 security가 맡으니 보고하지 않는다.',
  },
  {
    key: 'consistency',
    prompt:
      '바뀐 동작이 docs/spec/의 해당 절과 같은지, docs/spec/을 바꿨으면 같은 변경에서 요약 문서(기능·한도·화면·지표 → docs/PRD.md, API·데이터 모델·이벤트 → docs/ARCHITECTURE.md, 설계 결정 → docs/ADR.md, 화면 규칙 → docs/UI_GUIDE.md)도 바꿨는지, 파일 사이 타입·API 응답·에러 코드·이벤트 이름이 서로 맞는지.',
  },
]

const SEVERITY_SCHEMA = { type: 'string', enum: SEVERITIES }

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          severity: SEVERITY_SCHEMA,
          title: { type: 'string' },
          tldr: { type: 'string' },
          good: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'title', 'tldr', 'good', 'fix'],
      },
    },
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 2 },
  },
  required: ['findings', 'strengths'],
}

const VOTE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted'] },
    severity: SEVERITY_SCHEMA,
    reason: { type: 'string' },
  },
  required: ['verdict', 'severity', 'reason'],
}

const TIDY_SCHEMA = {
  type: 'object',
  properties: {
    strengths: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, sources: { type: 'array', items: { type: 'integer' } } },
        required: ['text', 'sources'],
      },
    },
    groups: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2 } },
  },
  required: ['strengths', 'groups'],
}

function rank(severity) {
  return SEVERITIES.indexOf(severity)
}

function normPath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '')
}

// args는 객체로 오지만 JSON 문자열로 와도 받는다
function readArgs(raw) {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value.base !== 'string' || !Array.isArray(value.files) || value.files.length === 0) return null
  return {
    base: value.base,
    files: value.files,
    docs: Array.isArray(value.docs) ? value.docs : [],
    walkthrough: typeof value.walkthrough === 'string' ? value.walkthrough : '',
    hunks: typeof value.hunks === 'string' ? value.hunks : null,
  }
}

function scopeText(input) {
  const files = input.files.map((f) => `- ${f.status} ${f.path}`).join('\n')
  const docs = input.docs.length ? input.docs.map((d) => `- ${d}`).join('\n') : '- (없음)'
  return `base: ${input.base}\n\n변경 파일:\n${files}\n\n가드레일 문서:\n${docs}`
}

function reviewPrompt(dimension, input) {
  return [
    `너는 Langrow 변경 사항을 리뷰하는 ${dimension.key} 차원 리뷰어다.`,
    `이 차원에서 보는 것: ${dimension.prompt}`,
    COMMON_RULES,
    SEVERITY_GUIDE,
    scopeText(input),
  ].join('\n\n')
}

// 커밋 안 한 새 파일은 git diff 출력이 비어 있어, 검증자가 "변경 없음"으로 반박하지 않게 직접 읽으라고 알린다
function diffGuide(finding, input) {
  const untracked = input.files.some((f) => f.status === '??' && normPath(f.path) === finding.file)
  return untracked
    ? '이 파일은 커밋 안 한 새 파일(??)이라 git diff에 나오지 않으니 파일을 직접 읽는다.'
    : `변경은 "git diff ${input.base} -- ${finding.file}"로 본다.`
}

function verifyPrompt(finding, dimension, input, n) {
  return [
    `너는 코드 리뷰 지적 하나를 검증하는 ${n}번째 독립 검증자다. 반박하는 쪽에서 시작한다.`,
    `지적 (${dimension.key}): ${finding.file}:${finding.line} [${finding.severity}] ${finding.title}`,
    `TL;DR: ${finding.tldr}\nGood: ${finding.good}\nFix: ${finding.fix}`,
    `${diffGuide(finding, input)} 읽기 전용이다. 파일을 고치지 않는다.`,
    '코드 경로를 직접 따라가 이 문제가 실제로 생기는 상황을 세울 수 있으면 verdict는 confirmed, 세우지 못하거나 확신이 없으면 refuted다.',
    'confirmed면 severity는 아래 기준으로 네가 매긴 심각도, refuted면 리뷰어의 심각도를 그대로 적는다. reason은 근거를 한두 문장으로 쓴다.',
    SEVERITY_GUIDE,
  ].join('\n\n')
}

// 심각도 중앙값. 짝수면 덜 심한 쪽
function medianSeverity(severities) {
  const sorted = [...severities].sort((a, b) => rank(a) - rank(b))
  return sorted[Math.floor(sorted.length / 2)]
}

// refuted 2표면 버리고, confirmed 2표면 남긴다. 검증자 실패로 어느 쪽도 2표가 안 되면 남기고 검증 실패로 표시한다
function tally(votes, reviewerSeverity) {
  const valid = votes.filter(Boolean)
  const confirmed = valid.filter((v) => v.verdict === 'confirmed').map((v) => v.severity)
  const refuted = valid.filter((v) => v.verdict === 'refuted').length
  if (refuted >= 2) return { status: 'refuted', severity: reviewerSeverity }
  if (confirmed.length >= 2) return { status: 'confirmed', severity: medianSeverity(confirmed) }
  return { status: 'unverified', severity: confirmed.length ? medianSeverity(confirmed) : reviewerSeverity }
}

async function verify(review, dimension, input) {
  if (!review) return null
  const judged = await parallel(
    review.findings.map((finding) => async () => {
      const file = normPath(finding.file)
      const votes = await parallel(
        Array.from({ length: VOTERS }, (_, i) => () =>
          agent(verifyPrompt({ ...finding, file }, dimension, input, i + 1), {
            label: `verify:${dimension.key}:${file}:${finding.line}#${i + 1}`,
            phase: 'Verify',
            schema: VOTE_SCHEMA,
          }),
        ),
      )
      return { ...finding, file, dimension: dimension.key, ...tally(votes, finding.severity) }
    }),
  )
  return { findings: judged.filter(Boolean), strengths: review.strengths ?? [] }
}

// 같은 파일·줄의 지적은 하나로. 가장 심한 지적의 내용을 쓰고 차원 태그를 모은다
function mergeDuplicates(findings) {
  const merged = new Map()
  for (const f of findings) {
    const key = `${f.file}:${f.line}`
    const prev = merged.get(key)
    if (!prev) {
      merged.set(key, { ...f, dimensions: [f.dimension] })
      continue
    }
    const dimensions = prev.dimensions.includes(f.dimension) ? prev.dimensions : [...prev.dimensions, f.dimension]
    const winner = rank(f.severity) < rank(prev.severity) ? f : prev
    merged.set(key, { ...winner, dimensions })
  }
  return [...merged.values()]
}

function compareFindings(a, b) {
  const byFile = a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  return rank(a.severity) - rank(b.severity) || byFile || a.line - b.line
}

// 차원마다 쓴 잘된 점. 글자가 같으면 하나로 합치고 차원 태그를 모은다
function collectStrengths(results) {
  const merged = new Map()
  results.forEach((result, i) => {
    for (const text of result?.strengths ?? []) {
      const dimensions = merged.get(text) ?? []
      if (!dimensions.includes(DIMENSIONS[i].key)) dimensions.push(DIMENSIONS[i].key)
      merged.set(text, dimensions)
    }
  })
  return [...merged].map(([text, dimensions]) => ({ text, dimensions }))
}

function tidyPrompt(strengths, findings) {
  const list = (items, render) => (items.length ? items.map(render).join('\n') : '(없음)')
  return [
    '너는 코드 리뷰 결과를 정리한다. 차원 4개의 리뷰어가 따로 써서 같은 내용이 겹친다. 코드는 읽지 않고 아래 글만 보고 판단한다.',
    `잘된 점:\n${list(strengths, (s, i) => `S${i + 1} [${s.dimensions.join(', ')}] ${s.text}`)}`,
    `지적:\n${list(findings, (f, i) => `F${i + 1} ${f.file}:${f.line} [${f.severity}] ${f.title} — ${f.tldr}`)}`,
    'strengths: 같은 코드나 같은 성질을 말하는 잘된 점을 하나로 합쳐 3개 이하로 쓴다. 3개가 넘으면 중요한 것을 남긴다. text는 한국어 한두 문장, sources는 합친 S 번호(숫자만)다.',
    'groups: 원인이 같아 하나를 고치면 나머지도 풀리는 지적끼리 F 번호(숫자만)로 묶는다. 같은 파일이나 가까운 줄이라는 것만으로 묶지 않는다. 확실하지 않으면 묶지 않는다. 묶을 것이 없으면 빈 배열이다.',
  ].join('\n\n')
}

// 합칠 게 없으면 부르지 않는다. 실패하면 null이고 조립은 정리 전 결과를 쓴다
async function tidy(strengths, findings) {
  if (strengths.length < 2 && findings.length < 2) return null
  return agent(tidyPrompt(strengths, findings), { label: 'tidy', phase: 'Tidy', schema: TIDY_SCHEMA }).catch(() => null)
}

// 묶음마다 가장 심한 지적 하나를 남기고 나머지는 merged로 단다. 없는 번호·앞 묶음에 쓴 번호는 버린다
function applyGroups(findings, groups) {
  const used = new Set()
  const merged = []
  for (const group of groups) {
    const members = [...new Set(group)].filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= findings.length && !used.has(n),
    )
    if (members.length < 2) continue
    members.forEach((n) => used.add(n))
    const [winner, ...rest] = members.map((n) => findings[n - 1]).sort(compareFindings)
    merged.push({ ...winner, dimensions: [...new Set([winner, ...rest].flatMap((f) => f.dimensions))], merged: rest })
  }
  return [...findings.filter((_, i) => !used.has(i + 1)), ...merged].sort(compareFindings)
}

// 리뷰가 실패한 차원이 있으면 Approve를 내지 않는다
function decideVerdict(findings, failed) {
  if (findings.some((f) => f.severity === 'critical')) return 'Blocked'
  if (findings.some((f) => f.severity === 'major') || failed.length) return 'Changes Requested'
  return 'Approve'
}

function nextActions(verdict, findings, failed) {
  const actions = failed.length ? [`⚠ ${failed.join(', ')} 리뷰가 실패했다. /review-code를 다시 돌린다`] : []
  if (verdict === 'Blocked') actions.push('Critical을 고친 뒤 /review-code를 다시 돌린다')
  else if (findings.some((f) => f.severity === 'major')) actions.push('Major를 고친 뒤 병합한다')
  else if (verdict === 'Approve') actions.push('병합해도 된다. Minor·Nit는 골라서 고친다')
  return actions
}

function unverifiedMark(f) {
  return f.unverified ? ' (검증 실패)' : ''
}

function titleLine(f) {
  return `[${ICON[f.severity]} ${NAME[f.severity]}] ${f.title}${unverifiedMark(f)}`
}

// fix 안의 백틱 연속보다 한 칸 긴 펜스로 감싼다(최소 3). 안쪽 ```가 바깥 펜스를 닫아 뒤의 지적을 삼키지 않게 한다
function fixLine(fix) {
  if (!fix.includes('\n')) return `→ Fix: ${fix}`
  const longest = Math.max(0, ...(fix.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `→ Fix:\n${fence}\n${fix}\n${fence}`
}

function mergedLines(f) {
  return (f.merged ?? []).map((m) => `합친 지적: ${m.file}:${m.line} [${ICON[m.severity]}] ${m.title}`)
}

function renderInline(f) {
  return [
    `${f.file}:${f.line} [${f.dimensions.join(', ')}]`,
    titleLine(f),
    `TL;DR: ${f.tldr}`,
    `Good: ${f.good}`,
    fixLine(f.fix),
    ...mergedLines(f),
  ].join('\n')
}

// PR 인라인 코멘트. 위치는 코멘트가 달린 줄이 대신하므로 차원 태그를 제목 줄에 붙인다
function renderComment(f) {
  return [
    `${titleLine(f)} [${f.dimensions.join(', ')}]`,
    `TL;DR: ${f.tldr}`,
    `Good: ${f.good}`,
    fixLine(f.fix),
    ...mergedLines(f),
  ].join('\n')
}

// git diff -U0의 "+++ b/<파일>"과 "@@ -a,b +c,d @@" 줄에서 파일별 변경 후 줄 범위를 읽는다.
// 삭제만 있는 hunk(+c,0)와 삭제된 파일(+++ /dev/null)은 인라인을 달 수 있는 범위가 아니다
function parseHunks(text) {
  const ranges = new Map()
  let file = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      file = path === '/dev/null' ? null : normPath(path.replace(/^b\//, ''))
      continue
    }
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!match || !file) continue
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    if (count === 0) continue
    if (!ranges.has(file)) ranges.set(file, [])
    ranges.get(file).push([start, start + count - 1])
  }
  return ranges
}

// hunks가 없으면(PR 게시 불가) null. diff 밖 줄의 지적은 인라인으로 달 수 없어 본문으로 옮긴다
function buildReview(findings, summary, hunks) {
  if (hunks === null) return null
  const ranges = parseHunks(hunks)
  const inDiff = (f) => (ranges.get(f.file) ?? []).some(([from, to]) => f.line >= from && f.line <= to)
  const outside = findings.filter((f) => !inDiff(f))
  return {
    body: outside.length ? `${summary}\n\n## diff 밖 지적\n\n${outside.map(renderInline).join('\n\n')}` : summary,
    comments: findings
      .filter(inDiff)
      .map((f) => ({ path: f.file, line: f.line, side: 'RIGHT', body: renderComment(f) })),
  }
}

function renderSummary({ verdict, findings, failed, refutedCount, walkthrough, strengths }) {
  const count = (severity) => findings.filter((f) => f.severity === severity).length
  const unverified = findings.filter((f) => f.unverified).length
  const serious = findings.filter((f) => rank(f.severity) <= rank('major'))
  const lines = [
    `## 리뷰 요약 — ${verdict}`,
    `${SEVERITIES.map((s) => `${ICON[s]} ${count(s)}`).join(' · ')}   (검증에서 버린 지적 ${refutedCount}개 · 검증 실패 ${unverified}개)`,
  ]
  if (failed.length) lines.push(`⚠ 미완료 차원: ${failed.join(', ')}`)
  lines.push(
    '',
    'Walkthrough',
    walkthrough || '(없음)',
    '',
    '잘된 점',
    ...(strengths.length
      ? strengths.map((s) => `- ${s.text}${s.dimensions.length ? ` [${s.dimensions.join(', ')}]` : ''}`)
      : ['- (없음)']),
    '',
    'Critical · Major',
    ...(serious.length
      ? serious.map((f) => `- ${ICON[f.severity]} ${f.file}:${f.line} ${f.title}${unverifiedMark(f)} [${f.dimensions.join(', ')}]`)
      : ['- 없음']),
    '',
    '다음 액션',
    ...nextActions(verdict, findings, failed).map((a) => `- ${a}`),
  )
  return lines.join('\n')
}

async function assemble(results, input) {
  const failed = DIMENSIONS.filter((_, i) => !results[i]).map((d) => d.key)
  const judged = results.filter(Boolean).flatMap((r) => r.findings)
  const refutedCount = judged.filter((f) => f.status === 'refuted').length
  const kept = judged
    .filter((f) => f.status !== 'refuted')
    .map((f) => ({ ...f, unverified: f.status === 'unverified' }))
  const deduped = mergeDuplicates(kept).sort(compareFindings)
  const collected = collectStrengths(results)
  const tidied = await tidy(collected, deduped)
  const findings = tidied ? applyGroups(deduped, tidied.groups) : deduped
  const strengths = tidied
    ? tidied.strengths.map((s) => ({
        text: s.text,
        dimensions: [...new Set(s.sources.flatMap((n) => collected[n - 1]?.dimensions ?? []))],
      }))
    : collected
  const verdict = decideVerdict(findings, failed)
  const summary = renderSummary({ verdict, findings, failed, refutedCount, walkthrough: input.walkthrough, strengths })
  const inline = findings.length ? findings.map(renderInline).join('\n\n') : '- 없음'
  return { report: `${summary}\n\n## 인라인 코멘트\n\n${inline}`, review: buildReview(findings, summary, input.hunks), verdict }
}

const input = readArgs(args)
if (!input) {
  return {
    report: '이 workflow는 /review-code가 변경 범위와 문서를 모아 부른다. /review-code로 실행하세요.',
    review: null,
    verdict: null,
  }
}

const results = await pipeline(
  DIMENSIONS,
  (dimension) =>
    agent(reviewPrompt(dimension, input), {
      label: `review:${dimension.key}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
    }),
  (review, dimension) => verify(review, dimension, input),
)

return assemble(results, input)
