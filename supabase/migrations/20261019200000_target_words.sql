-- 배운 단어 써 보기 (spec/chat.md "배운 단어 써 보기", spec/backend.md "Claude 연동"의 "배운 단어", ADR-023)
--
-- 세션의 첫 턴에 예약 RPC가 세션 언어로 오늘(없으면 한국 날짜로 7일 안) 배운 단어를 후보로 주고,
-- 확정 RPC가 AI가 고른 단어를 세션의 목표 단어로 저장한다. 매 턴 사용자가 쓴 목표 단어를 그 턴에 저장한다.
-- 날짜는 DB 시각(kst_today_start)으로 정한다. 목표 단어가 없는 세션과 턴은 null이다.
-- 확정 RPC의 새 인자는 기본값이 null이라 새 인자 없이 부르는 지금 운영 코드도 그대로 동작한다.

alter table public.chat_sessions
  add column target_word_ids text[],
  add column target_source text,
  add constraint chat_sessions_target_source check (target_source in ('today', 'recent')),
  add constraint chat_sessions_target_pair check ((target_word_ids is null) = (target_source is null)),
  add constraint chat_sessions_target_count
    check (target_word_ids is null or cardinality(target_word_ids) between 1 and 5);

alter table public.chat_turns
  add column used_word_ids text[];

-- 세션의 목표 단어 [{ id, word, reading, meaning_ko, used }] (고른 순서). 목표 단어가 없으면 null.
-- used는 이 세션의 done 턴들의 used_word_ids에 있는지다 (pending은 세지 않는다)
create function public.chat_target_words(p_user_id uuid, p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_agg(
           jsonb_build_object(
             'id', w.id,
             'word', w.word,
             'reading', w.reading,
             'meaning_ko', w.meaning_ko,
             'used', exists (
               select 1 from public.chat_turns t
                where t.session_id = s.id and t.user_id = p_user_id and t.status = 'done'
                  and w.id = any (t.used_word_ids)))
           order by ids.ord)
    from public.chat_sessions s
   cross join lateral unnest(s.target_word_ids) with ordinality as ids(word_id, ord)
    join public.words w on w.id = ids.word_id
   where s.id = p_session_id and s.user_id = p_user_id;
$$;

-- 턴 예약. pending 행과 작업 토큰(= 그 행의 id, 90초)을 커밋한 뒤 use-case가 잠금 밖에서 Claude를 부른다.
-- 첫 턴이고 목표 단어가 없으면 후보 단어(candidates, 최대 20개)와 출처를, 목표 단어가 있으면 그 상태(targets)를 준다
create or replace function public.begin_chat_turn(p_user_id uuid, p_session_id uuid, p_user_text text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_code text;
  v_done int;
  v_last_turn_no int;
  v_history jsonb;
  v_token uuid;
  v_today_start timestamptz;
  v_candidates jsonb;
  v_candidate_source text;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  perform public.recover_expired_operations(p_user_id);
  select * into v_session from public.chat_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  v_code := public.check_readiness(p_user_id, 'ready', v_session.language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  -- 종료 중·끝난 세션이거나 처리 중인 턴이 있다. unique(session_id, turn_no) 위반에 기대지 않는다
  if v_session.status <> 'active' or v_session.operation_token is not null then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  if public.chat_failure_limit_reached(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'AI_FAILURE_LIMIT');
  end if;

  select count(*), coalesce(max(turn_no), 0),
         coalesce(jsonb_agg(jsonb_build_object('user_text', user_text, 'reply', reply) order by turn_no), '[]')
    into v_done, v_last_turn_no, v_history
    from public.chat_turns
   where session_id = p_session_id and user_id = p_user_id and status = 'done';
  if v_done >= 20 then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FULL');
  end if;

  -- 계정 전체(모든 언어·세션)의 오늘 턴. 예약 시각 기준이고 pending도 센다
  if (select count(*) from public.chat_turns
       where user_id = p_user_id and created_at >= public.kst_today_start())
     >= public.chat_turn_limit(p_user_id) then
    perform public.record_limit_reached(p_user_id, 'chat');
    return jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED');
  end if;

  insert into public.chat_turns (session_id, user_id, turn_no, status, user_text)
    values (p_session_id, p_user_id, v_last_turn_no + 1, 'pending', p_user_text)
    returning id into v_token;
  update public.chat_sessions
     set operation_token = v_token, operation_expires_at = now() + interval '90 seconds'
   where id = p_session_id and user_id = p_user_id;

  -- 후보 단어: 세션 언어로 오늘 배운 단어, 없으면 오늘을 포함한 7일 안에 배운 단어. 레벨·status는 따지지 않는다.
  -- 오늘 이 계정의 대화(모든 세션)에서 이미 쓴 단어를 뒤로 보내고, 그 안에서는 최근에 배운 것부터, 같으면 id 순
  if v_done = 0 and v_session.target_word_ids is null then
    v_today_start := public.kst_today_start();
    v_candidate_source := case
      when exists (
        select 1 from public.user_words uw
          join public.words w on w.id = uw.word_id
         where uw.user_id = p_user_id and w.language = v_session.language and uw.first_seen_at >= v_today_start)
      then 'today'
      else 'recent'
    end;
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id', c.id, 'word', c.word, 'reading', c.reading, 'meaning_ko', c.meaning_ko,
               'used_today', c.used_today)
             order by c.used_today, c.first_seen_at desc, c.id), '[]')
      into v_candidates
      from (
        select w.id, w.word, w.reading, w.meaning_ko, uw.first_seen_at,
               exists (
                 select 1 from public.chat_turns t
                  where t.user_id = p_user_id and t.status = 'done' and t.created_at >= v_today_start
                    and w.id = any (t.used_word_ids)) as used_today
          from public.user_words uw
          join public.words w on w.id = uw.word_id
         where uw.user_id = p_user_id and w.language = v_session.language
           and uw.first_seen_at >= case v_candidate_source
                                     when 'today' then v_today_start
                                     else v_today_start - interval '6 days'
                                   end
         order by used_today, uw.first_seen_at desc, w.id
         limit 20
      ) c;
    if jsonb_array_length(v_candidates) = 0 then
      v_candidate_source := null;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'turn_no', v_last_turn_no + 1,
    'language', v_session.language,
    'level', v_session.level,
    'scenario_id', v_session.scenario_id,
    'history', v_history,
    'candidates', v_candidates,
    'candidate_source', v_candidate_source,
    'targets', public.chat_target_words(p_user_id, p_session_id));
end;
$$;

drop function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text, jsonb);

-- 턴 성공 확정. 기한이 지난 토큰은 위 복구에서 풀리므로 불일치(CONFLICT)가 된다.
-- p_reply_pron_ko·p_reply_breakdown과 배운 단어 인자는 값이 없는 턴에서 빼고 부를 수 있게 뒤쪽 인자이고 기본값이 null이다
create function public.finish_chat_turn(
  p_user_id uuid, p_session_id uuid, p_token uuid, p_reply text, p_reply_ko text, p_correction jsonb,
  p_reply_pron_ko text default null, p_reply_breakdown jsonb default null,
  p_target_word_ids text[] default null, p_target_source text default null, p_used_word_ids text[] default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_reserved_at timestamptz;
  v_turn_no int;
  v_target_ids text[];
  v_target_source text;
  v_done int;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  perform public.recover_expired_operations(p_user_id);
  select * into v_session from public.chat_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_session.status <> 'active' or v_session.operation_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  update public.chat_turns
     set status = 'done', reply = p_reply, reply_ko = p_reply_ko, reply_pron_ko = p_reply_pron_ko,
         reply_breakdown = p_reply_breakdown, correction = p_correction
   where id = p_token and session_id = p_session_id and user_id = p_user_id and status = 'pending'
   returning created_at, turn_no into v_reserved_at, v_turn_no;
  if not found then
    raise exception 'finish_chat_turn: 작업 토큰의 pending 턴이 없습니다';
  end if;

  -- 목표 단어는 목표 단어가 없는 세션의 첫 턴에서만 저장하고 그 뒤에는 바꾸지 않는다.
  -- 받은 순서대로 중복 없이, 이 사용자가 배운 세션 언어의 단어만 앞에서 5개까지 남긴다
  v_target_ids := v_session.target_word_ids;
  v_target_source := v_session.target_source;
  if v_target_ids is null and v_turn_no = 1 and p_target_word_ids is not null
     and p_target_source in ('today', 'recent') then
    select array_agg(picked.word_id order by picked.ord)
      into v_target_ids
      from (
        select given.word_id, min(given.ord) as ord
          from unnest(p_target_word_ids) with ordinality as given(word_id, ord)
          join public.user_words uw on uw.user_id = p_user_id and uw.word_id = given.word_id
          join public.words w on w.id = given.word_id and w.language = v_session.language
         group by given.word_id
         order by min(given.ord)
         limit 5
      ) picked;
    if v_target_ids is not null then
      v_target_source := p_target_source;
      update public.chat_sessions
         set target_word_ids = v_target_ids, target_source = v_target_source
       where id = p_session_id and user_id = p_user_id;
    end if;
  end if;

  -- 쓴 단어: 목표 단어 안의 것만 중복 없이(없으면 빈 배열). 목표 단어가 없는 세션의 턴은 null로 둔다
  if v_target_ids is not null then
    update public.chat_turns
       set used_word_ids = coalesce((
             select array_agg(used.word_id order by used.ord)
               from (
                 select given.word_id, min(given.ord) as ord
                   from unnest(p_used_word_ids) with ordinality as given(word_id, ord)
                  where given.word_id = any (v_target_ids)
                  group by given.word_id
               ) used), '{}')
     where id = p_token and session_id = p_session_id and user_id = p_user_id;
  end if;

  update public.chat_sessions
     set operation_token = null, operation_expires_at = null
   where id = p_session_id and user_id = p_user_id;
  perform public.record_activity(p_user_id);

  -- 이 확정으로 오늘 계정의 done 턴 수가 한도와 같아지면 기록한다 (spec/metrics.md "지표 수집")
  if v_reserved_at >= public.kst_today_start()
     and (select count(*) from public.chat_turns
           where user_id = p_user_id and status = 'done' and created_at >= public.kst_today_start())
         = public.chat_turn_limit(p_user_id) then
    perform public.record_limit_reached(p_user_id, 'chat');
  end if;

  select count(*) into v_done
    from public.chat_turns
   where session_id = p_session_id and user_id = p_user_id and status = 'done';
  return jsonb_build_object(
    'ok', true,
    'turns_left', 20 - v_done,
    'target_words', public.chat_target_words(p_user_id, p_session_id),
    'target_source', v_target_source);
end;
$$;

revoke execute on function public.chat_target_words(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_target_words(uuid, uuid) to service_role;
revoke execute on function public.begin_chat_turn(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_chat_turn(uuid, uuid, text) to service_role;
revoke execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text, jsonb, text[], text, text[])
  from public, anon, authenticated;
grant execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text, jsonb, text[], text, text[])
  to service_role;
