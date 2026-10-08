-- AI 정답 설명: 공용 저장본(word_explanations), 사용 기록(word_explained 이벤트), 예약·실패·저장 RPC
-- (spec/words.md "AI 정답 설명", spec/usage.md "세는 방법", spec/backend.md "데이터 접근과 보안")
--
-- 함수 규칙은 schema 마이그레이션 머리말과 같다. 예약·실패 RPC는 먼저 profiles를 FOR UPDATE로 잠근다.
-- 저장 RPC는 사용자와 무관한 공용 행만 바꾸므로 p_user_id를 받지 않고 profiles를 잠그지 않는다.
-- Claude 호출은 예약과 실패·저장 사이에서 use-case가 한다. RPC는 잠금을 쥔 채 기다리지 않는다.
--
-- 상수 (테스트는 lib 상수와 같은 값으로 기대값을 만든다)
-- - Free 하루 AI 설명 10회 (src/lib/plan.ts의 FREE_DAILY_EXPLANATIONS). Pro는 세지 않지만 행은 남긴다
-- - 하루 AI 실패 10회는 대화와 같은 chat_failure_limit_reached로 본다

-- 이벤트 이름 ----------------------------------------------------------

alter table public.events drop constraint events_name_check;
alter table public.events add constraint events_name_check check (
  name in ('limit_reached', 'pro_clicked', 'kana_studied', 'level_test_submitted', 'chat_failed', 'word_explained'));

-- 테이블 ---------------------------------------------------------------

-- (단어, 고른 보기)별 공용 설명. 복습은 choice가 빈 문자열이다. word_hash는 설명을 만들 때의 단어 기준이다
create table public.word_explanations (
  word_id text not null references public.words (id) on delete cascade,
  choice text not null,
  explanation text not null,
  word_hash text not null,
  created_at timestamptz not null default now(),
  primary key (word_id, choice)
);

-- RLS는 켜고 정책은 두지 않는다. 기본 권한으로 받은 authenticated의 SELECT도 회수해 서버 RPC로만 읽는다
alter table public.word_explanations enable row level security;
revoke all on table public.word_explanations from anon, authenticated;

-- helper ---------------------------------------------------------------

-- 단어의 예문·번역·뜻이 바뀌면 달라진다. 저장본이 지금 단어 기준인지 가린다. 단어가 없으면 null
create function public.word_hash(p_word_id text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select md5(concat_ws(chr(31), example, example_ko, meaning_ko)) from public.words where id = p_word_id;
$$;

-- RPC ------------------------------------------------------------------

-- 설명 예약. state: cached(지금 단어 기준 저장본, AI를 부르지 않는다) | reserved(사용 기록 id, use-case가 AI를 부른다).
-- 사용 기록(word_explained)이 곧 하루 한도의 카운터이며 별도 확정 단계는 없다
create function public.begin_word_explanation(p_user_id uuid, p_word_id text, p_choice text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_language text;
  v_code text;
  v_props jsonb;
  v_explanation text;
  v_event_id bigint;
begin
  perform 1 from public.profiles where id = p_user_id for update;

  select language into v_language from public.words where id = p_word_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  v_code := public.check_readiness(p_user_id, 'ready', v_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  -- 계정 전체(언어 합산)의 오늘 설명. 저장본 응답도 센다.
  -- 한도 거부는 limit_reached로 남기지 않는다 (spec/metrics.md "지표 수집")
  if public.current_plan(p_user_id) = 'free'
     and (select count(*) from public.events
           where user_id = p_user_id and name = 'word_explained' and created_at >= public.kst_today_start())
         >= 10 then
    return jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED');
  end if;

  -- 고른 보기와 설명 내용은 넣지 않는다
  v_props := jsonb_build_object(
    'language', v_language,
    'word_id', p_word_id,
    'kind', case when p_choice = '' then 'review' else 'quiz' end);

  select explanation into v_explanation
    from public.word_explanations
   where word_id = p_word_id and choice = p_choice and word_hash = public.word_hash(p_word_id);
  if found then
    insert into public.events (user_id, name, props)
      values (p_user_id, 'word_explained', v_props || jsonb_build_object('cached', true));
    return jsonb_build_object('ok', true, 'state', 'cached', 'explanation', v_explanation);
  end if;

  -- 저장본이 없을 때만 AI를 부르므로 여기서 실패 한도를 본다
  if public.chat_failure_limit_reached(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'AI_FAILURE_LIMIT');
  end if;

  insert into public.events (user_id, name, props)
    values (p_user_id, 'word_explained', v_props || jsonb_build_object('cached', false))
    returning id into v_event_id;
  return jsonb_build_object('ok', true, 'state', 'reserved', 'event_id', v_event_id);
end;
$$;

-- AI 생성 실패. 예약(사용 기록)을 돌려주고 실패를 한 번만 남긴다. 이미 지웠거나 남의 id면 아무것도 바꾸지 않는다
create function public.fail_word_explanation(p_user_id uuid, p_event_id bigint, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;

  delete from public.events
   where id = p_event_id and user_id = p_user_id and name = 'word_explained';
  if found then
    perform public.record_chat_failed(p_user_id, null, 'explain', p_reason);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- AI 생성 성공. 해시는 지금 단어 행으로 계산한다. 같은 키가 있으면 해시가 다를 때(옛 단어 기준)만 바꾸고,
-- 같으면 먼저 저장된 것을 둔다 (동시에 처음 요청한 두 사람이 AI를 두 번 부르는 것은 허용한다)
create function public.save_word_explanation(p_word_id text, p_choice text, p_explanation text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash text := public.word_hash(p_word_id);
begin
  if v_hash is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  insert into public.word_explanations as e (word_id, choice, explanation, word_hash)
    values (p_word_id, p_choice, p_explanation, v_hash)
  on conflict (word_id, choice) do update
    set explanation = excluded.explanation, word_hash = excluded.word_hash, created_at = now()
    where e.word_hash <> excluded.word_hash;
  return jsonb_build_object('ok', true);
end;
$$;

-- 함수 실행 권한: service_role만 ----------------------------------------

revoke execute on function public.word_hash(text) from public, anon, authenticated;
grant execute on function public.word_hash(text) to service_role;
revoke execute on function public.begin_word_explanation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_word_explanation(uuid, text, text) to service_role;
revoke execute on function public.fail_word_explanation(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.fail_word_explanation(uuid, bigint, text) to service_role;
revoke execute on function public.save_word_explanation(text, text, text) from public, anon, authenticated;
grant execute on function public.save_word_explanation(text, text, text) to service_role;
