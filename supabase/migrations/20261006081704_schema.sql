-- Langrow 스키마: 테이블, 상태 제약, 인덱스, RLS, 권한, helper, 계정 RPC (spec 6-3, 6-5)
--
-- 함수 규칙 (step 1·2의 RPC도 같다)
-- - SECURITY INVOKER, search_path = '' (본문은 public.을 붙인다)
-- - EXECUTE는 PUBLIC·anon·authenticated에서 회수하고 service_role에만 준다
-- - 첫 인자는 서버가 getUser()로 검증한 p_user_id
-- - 응답은 jsonb: 성공 {"ok": true, ...값}, 예상된 거부 {"ok": false, "code": "<ErrorCode>"}. 키는 snake_case
--   예상된 거부는 raise하지 않고 반환해 같은 트랜잭션의 복구·이벤트 기록을 커밋한다
-- - 사용자 상태를 바꾸는 RPC는 먼저 profiles 행을 FOR UPDATE로 잠근다
-- - 날짜·플랜·한도는 함수 안의 now()로 판정한다

-- 앞으로 만드는 테이블·함수에도 같은 권한을 적용한다.
-- PUBLIC의 함수 실행 권한은 전역 기본값이라 스키마를 지정하지 않고 회수한다
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant select on tables to authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- 테이블 ---------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  current_language text check (current_language in ('en', 'ja')),
  pro_until timestamptz,
  trial_started_at timestamptz,
  agreed_at timestamptz,
  onboarded_at timestamptz,
  last_study_date date,
  streak int not null default 0,
  created_at timestamptz not null default now()
);

create table public.user_levels (
  user_id uuid not null references auth.users (id) on delete cascade,
  language text not null check (language in ('en', 'ja')),
  level int not null check (level between 1 and 5),
  primary key (user_id, language)
);

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  language text not null check (language in ('en', 'ja')),
  level int not null check (level between 1 and 5),
  scenario_id text not null,
  status text not null default 'active' check (status in ('active', 'ending', 'ended')),
  operation_token uuid,
  operation_expires_at timestamptz,
  feedback_status text not null default 'none'
    check (feedback_status in ('none', 'pending', 'ready', 'fallback', 'skipped')),
  feedback jsonb,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint chat_sessions_operation_pair
    check ((operation_token is null) = (operation_expires_at is null)),
  constraint chat_sessions_status_state check (
    (status = 'active' and feedback_status = 'none' and ended_at is null)
    or (status = 'ending' and operation_token is not null and feedback_status = 'pending' and ended_at is null)
    or (status = 'ended' and operation_token is null and ended_at is not null
        and feedback_status in ('ready', 'fallback', 'skipped'))
  ),
  constraint chat_sessions_feedback_saved
    check ((feedback_status in ('ready', 'fallback')) = (feedback is not null))
);

create table public.chat_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  turn_no int not null check (turn_no between 1 and 20),
  status text not null default 'pending' check (status in ('pending', 'done')),
  user_text text not null check (char_length(user_text) between 1 and 300),
  reply text,
  reply_ko text,
  correction jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, turn_no),
  constraint chat_turns_done_has_reply
    check (status <> 'done' or (reply is not null and reply_ko is not null))
);

create table public.words (
  id text primary key,
  language text not null check (language in ('en', 'ja')),
  level int not null check (level between 1 and 5),
  rank int not null,
  word text not null,
  reading text,
  meaning_ko text not null,
  example text not null,
  example_ko text not null,
  distractors text[] not null check (cardinality(distractors) = 3),
  unique (language, level, rank)
);

create table public.user_words (
  user_id uuid not null references auth.users (id) on delete cascade,
  word_id text not null references public.words (id),
  status text not null check (status in ('known', 'review')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, word_id)
);

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    check (name in ('limit_reached', 'pro_clicked', 'kana_studied', 'level_test_submitted', 'chat_failed')),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- 학습 성공이 있는 한국 날짜만 행이 있다
create table public.user_activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  primary key (user_id, activity_date)
);

-- 인덱스 ---------------------------------------------------------------

create index chat_turns_user_created on public.chat_turns (user_id, created_at);
create index user_words_user_first_seen on public.user_words (user_id, first_seen_at);
create index events_user_name_created on public.events (user_id, name, created_at);
create index chat_sessions_user_language_status_created
  on public.chat_sessions (user_id, language, status, created_at);
create index chat_sessions_user_operation_expires on public.chat_sessions (user_id, operation_expires_at);

-- 세션당 pending 턴은 1개다
create unique index chat_turns_one_pending on public.chat_turns (session_id) where status = 'pending';

-- RLS: 자기 행 읽기만. 쓰기 정책은 두지 않는다 (쓰기는 service_role RPC로만) -----------

alter table public.profiles enable row level security;
alter table public.user_levels enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_turns enable row level security;
alter table public.words enable row level security;
alter table public.user_words enable row level security;
alter table public.events enable row level security;
alter table public.user_activity_days enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy user_levels_select_own on public.user_levels
  for select to authenticated using (user_id = (select auth.uid()));
create policy chat_sessions_select_own on public.chat_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy chat_turns_select_own on public.chat_turns
  for select to authenticated using (user_id = (select auth.uid()));
create policy words_select_all on public.words
  for select to authenticated using (true);
create policy user_words_select_own on public.user_words
  for select to authenticated using (user_id = (select auth.uid()));
create policy events_select_own on public.events
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_activity_days_select_own on public.user_activity_days
  for select to authenticated using (user_id = (select auth.uid()));

-- 테이블 권한: anon은 없음, authenticated는 SELECT만
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- helper ---------------------------------------------------------------

-- 오늘 한국 날짜. 서머타임이 없어서 UTC+9로 고정 계산한다 (src/lib/usage.ts의 kstDate와 같은 규칙)
create function public.kst_today()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select ((now() at time zone 'UTC') + interval '9 hours')::date;
$$;

-- src/lib/readiness.ts의 checkReadiness와 같은 규칙. 문제가 없으면 null.
-- profiles 행이 없으면 CONSENT_REQUIRED. 호출하는 쪽이 profiles를 잠갔다고 가정한다
create function public.check_readiness(p_user_id uuid, p_requirement text, p_language text default null)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_agreed_at timestamptz;
  v_current_language text;
begin
  if p_requirement not in ('consent', 'ready') then
    raise exception 'unknown requirement: %', p_requirement;
  end if;

  select agreed_at, current_language into v_agreed_at, v_current_language
    from public.profiles where id = p_user_id;
  if v_agreed_at is null then
    return 'CONSENT_REQUIRED';
  end if;

  if p_language is not null and not exists (
    select 1 from public.user_levels where user_id = p_user_id and language = p_language
  ) then
    return 'ONBOARDING_REQUIRED';
  end if;

  if p_requirement = 'ready' and not exists (
    select 1 from public.user_levels where user_id = p_user_id and language = v_current_language
  ) then
    return 'ONBOARDING_REQUIRED';
  end if;

  return null;
end;
$$;

-- 오늘 활동일 행과 연속 학습일을 갱신한다 (src/lib/streak.ts의 nextStreak와 같은 규칙).
-- 따로 불려도 안전하도록 profiles를 직접 잠근다
create function public.record_activity(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := public.kst_today();
begin
  perform 1 from public.profiles where id = p_user_id for update;

  insert into public.user_activity_days (user_id, activity_date)
    values (p_user_id, v_today)
    on conflict do nothing;

  update public.profiles
     set streak = case
           when last_study_date = v_today then streak
           when last_study_date = v_today - 1 then streak + 1
           else 1
         end,
         last_study_date = v_today
   where id = p_user_id;
end;
$$;

-- 계정 RPC -------------------------------------------------------------

-- /auth/callback이 부른다. 가입 시각(created_at)은 처음 만든 값을 유지한다
create function public.ensure_profile(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- 최초 동의 시각을 유지한다. profiles 행이 없으면 만든다
create function public.agree_terms(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.profiles as p (id, agreed_at) values (p_user_id, now())
    on conflict (id) do update set agreed_at = coalesce(p.agreed_at, excluded.agreed_at);
  return jsonb_build_object('ok', true);
end;
$$;

-- 언어의 첫 레벨. 이미 있으면 CONFLICT(레벨업 우회 방지). 다른 언어를 처음 추가하는 것은 허용한다
create function public.set_first_level(p_user_id uuid, p_language text, p_level int)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'consent');
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  insert into public.user_levels (user_id, language, level)
    values (p_user_id, p_language, p_level)
    on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  update public.profiles
     set current_language = p_language,
         onboarded_at = coalesce(onboarded_at, now())
   where id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.switch_language(p_user_id uuid, p_language text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'consent', p_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  update public.profiles set current_language = p_language where id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 레벨 내리기만 한다. 같거나 높은 값은 CONFLICT
create function public.lower_level(p_user_id uuid, p_language text, p_level int)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'ready', p_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  update public.user_levels
     set level = p_level
   where user_id = p_user_id and language = p_language and level > p_level;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;
  return jsonb_build_object('ok', true, 'level', p_level);
end;
$$;

-- 7일 무료 체험은 계정당 1번 (src/lib/plan.ts의 TRIAL_DAYS와 같아야 한다)
create function public.start_trial(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
  v_pro_until timestamptz;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'ready');
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  update public.profiles
     set trial_started_at = now(),
         pro_until = now() + interval '7 days'
   where id = p_user_id and trial_started_at is null
   returning pro_until into v_pro_until;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;
  return jsonb_build_object('ok', true, 'pro_until', v_pro_until);
end;
$$;

-- 함수 실행 권한: service_role만 ----------------------------------------

revoke execute on function public.kst_today() from public, anon, authenticated;
grant execute on function public.kst_today() to service_role;
revoke execute on function public.check_readiness(uuid, text, text) from public, anon, authenticated;
grant execute on function public.check_readiness(uuid, text, text) to service_role;
revoke execute on function public.record_activity(uuid) from public, anon, authenticated;
grant execute on function public.record_activity(uuid) to service_role;
revoke execute on function public.ensure_profile(uuid) from public, anon, authenticated;
grant execute on function public.ensure_profile(uuid) to service_role;
revoke execute on function public.agree_terms(uuid) from public, anon, authenticated;
grant execute on function public.agree_terms(uuid) to service_role;
revoke execute on function public.set_first_level(uuid, text, int) from public, anon, authenticated;
grant execute on function public.set_first_level(uuid, text, int) to service_role;
revoke execute on function public.switch_language(uuid, text) from public, anon, authenticated;
grant execute on function public.switch_language(uuid, text) to service_role;
revoke execute on function public.lower_level(uuid, text, int) from public, anon, authenticated;
grant execute on function public.lower_level(uuid, text, int) to service_role;
revoke execute on function public.start_trial(uuid) from public, anon, authenticated;
grant execute on function public.start_trial(uuid) to service_role;
