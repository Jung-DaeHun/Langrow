-- 대화 RPC: 턴 예약 → 확정/실패, 종료 예약 → 완료/실패, 만료 작업 복구
-- (spec/chat.md "대화 1턴 처리"·"처리 중단 복구"·"세션 종료 피드백", spec/backend.md "데이터 접근과 보안")
--
-- 함수 규칙은 schema 마이그레이션 머리말과 같다.
-- 세션 RPC는 profiles 잠금 → recover_expired_operations → 세션(id + user_id) FOR UPDATE 순서로 잠근다.
-- 세션이 없거나 남의 것이면 NOT_FOUND이고 아무것도 바꾸지 않는다 (복구는 호출한 사용자의 작업만 한다).
-- Claude 호출은 RPC 사이에서 use-case가 한다. RPC는 잠금을 쥔 채 기다리지 않는다.
--
-- 상수 (테스트는 lib 상수와 같은 값으로 기대값을 만든다)
-- - 하루 대화 턴: Free 20, Pro 150 (src/lib/plan.ts의 PLAN_LIMITS). Pro는 pro_until > now()
-- - 세션당 최대 20턴, 하루 AI 실패 10회, 작업 기한 90초
-- - 대체 피드백: end_chat_with_fallback

-- helper ---------------------------------------------------------------

-- 오늘(한국 날짜) 0시. 하루 사용량·실패 횟수는 created_at이 이 시각 이후인 행으로 센다
create function public.kst_today_start()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select (public.kst_today()::timestamp - interval '9 hours') at time zone 'UTC';
$$;

-- src/lib/plan.ts의 planAt과 같은 규칙
create function public.current_plan(p_user_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when pro_until > now() then 'pro' else 'free' end
    from public.profiles
   where id = p_user_id;
$$;

-- 하루 대화 턴 한도 (PLAN_LIMITS.*.chatTurns)
create function public.chat_turn_limit(p_user_id uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select case public.current_plan(p_user_id) when 'pro' then 150 else 20 end;
$$;

-- 오늘 chat_failed가 10개 이상이면 새 AI 호출을 막는다
create function public.chat_failure_limit_reached(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) >= 10
    from public.events
   where user_id = p_user_id and name = 'chat_failed' and created_at >= public.kst_today_start();
$$;

-- props는 spec/metrics.md "지표 수집"
create function public.record_limit_reached(p_user_id uuid, p_feature text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.events (user_id, name, props)
  select p_user_id, 'limit_reached', jsonb_build_object(
           'feature', p_feature,
           'plan', public.current_plan(p_user_id),
           'trial_eligible', trial_started_at is null)
    from public.profiles
   where id = p_user_id;
$$;

-- 작업당 한 번만 부른다. 대화 내용은 넣지 않는다 (보안 체크리스트 10)
create function public.record_chat_failed(p_user_id uuid, p_operation_token uuid, p_kind text, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.events (user_id, name, props)
  values (p_user_id, 'chat_failed',
          jsonb_build_object('operation_token', p_operation_token, 'kind', p_kind, 'reason', p_reason));
$$;

-- 종합 피드백 없이 세션을 끝낸다 (생성 실패, 기한 만료, 실패 한도). 저장한 대체 피드백을 돌려준다
create function public.end_chat_with_fallback(p_user_id uuid, p_session_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.chat_sessions
     set status = 'ended',
         feedback_status = 'fallback',
         feedback = jsonb_build_object(
           'message', '대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요.'),
         ended_at = now(),
         operation_token = null,
         operation_expires_at = null
   where id = p_session_id and user_id = p_user_id
  returning feedback;
$$;

-- 이 사용자의 기한이 지난 작업을 복구한다. 정리용 cron 대신 다음 요청에서 부른다.
-- active: 그 토큰(= pending 턴 id)의 pending만 지우고 토큰을 푼다. ending: 대체 피드백으로 끝낸다.
-- 토큰을 같은 트랜잭션에서 풀기 때문에 chat_failed는 작업당 한 번만 남는다.
-- 호출하는 쪽이 profiles를 이미 잠갔다고 가정한다
create function public.recover_expired_operations(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session record;
begin
  for v_session in
    select id, status, operation_token
      from public.chat_sessions
     where user_id = p_user_id and operation_expires_at <= now()
       for update
  loop
    if v_session.status = 'active' then
      delete from public.chat_turns
       where id = v_session.operation_token and session_id = v_session.id
         and user_id = p_user_id and status = 'pending';
      update public.chat_sessions
         set operation_token = null, operation_expires_at = null
       where id = v_session.id and user_id = p_user_id;
      perform public.record_chat_failed(p_user_id, v_session.operation_token, 'turn', 'expired');
    else -- ending
      perform public.end_chat_with_fallback(p_user_id, v_session.id);
      perform public.record_chat_failed(p_user_id, v_session.operation_token, 'feedback', 'expired');
    end if;
  end loop;
end;
$$;

-- 대화 RPC -------------------------------------------------------------

-- Claude를 부르지 않는다. 상황이 그 레벨의 것인지는 use-case가 lib/scenarios로 검사한다
create function public.create_chat_session(p_user_id uuid, p_language text, p_level int, p_scenario_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
  v_session_id uuid;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  perform public.recover_expired_operations(p_user_id);
  v_code := public.check_readiness(p_user_id, 'ready', p_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  -- 화면을 연 뒤 레벨이 바뀌었다
  if not exists (
    select 1 from public.user_levels
     where user_id = p_user_id and language = p_language and level = p_level
  ) then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  insert into public.chat_sessions (user_id, language, level, scenario_id)
    values (p_user_id, p_language, p_level, p_scenario_id)
    returning id into v_session_id;
  return jsonb_build_object('ok', true, 'session_id', v_session_id);
end;
$$;

-- 턴 예약. pending 행과 작업 토큰(= 그 행의 id, 90초)을 커밋한 뒤 use-case가 잠금 밖에서 Claude를 부른다
create function public.begin_chat_turn(p_user_id uuid, p_session_id uuid, p_user_text text)
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

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'turn_no', v_last_turn_no + 1,
    'language', v_session.language,
    'level', v_session.level,
    'scenario_id', v_session.scenario_id,
    'history', v_history);
end;
$$;

-- 턴 성공 확정. 기한이 지난 토큰은 위 복구에서 풀리므로 불일치(CONFLICT)가 된다
create function public.finish_chat_turn(
  p_user_id uuid, p_session_id uuid, p_token uuid, p_reply text, p_reply_ko text, p_correction jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_reserved_at timestamptz;
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
     set status = 'done', reply = p_reply, reply_ko = p_reply_ko, correction = p_correction
   where id = p_token and session_id = p_session_id and user_id = p_user_id and status = 'pending'
   returning created_at into v_reserved_at;
  if not found then
    raise exception 'finish_chat_turn: 작업 토큰의 pending 턴이 없습니다';
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
  return jsonb_build_object('ok', true, 'turns_left', 20 - v_done);
end;
$$;

-- 턴 실패 확정 (재시도까지 실패한 작업). 예약을 돌려주므로 같은 turn_no로 다시 예약할 수 있다
create function public.fail_chat_turn(p_user_id uuid, p_session_id uuid, p_token uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
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

  delete from public.chat_turns
   where id = p_token and session_id = p_session_id and user_id = p_user_id and status = 'pending';
  update public.chat_sessions
     set operation_token = null, operation_expires_at = null
   where id = p_session_id and user_id = p_user_id;
  perform public.record_chat_failed(p_user_id, p_token, 'turn', p_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- 종료 시작. state: ended(저장된 결과) | ending(다른 요청이 처리 중) | reserved(이 요청만 Claude로 피드백을 만든다)
create function public.begin_end(p_user_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_code text;
  v_turns jsonb;
  v_token uuid;
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

  if v_session.status = 'ended' then
    return jsonb_build_object('ok', true, 'state', 'ended',
      'feedback_status', v_session.feedback_status, 'feedback', v_session.feedback);
  end if;
  if v_session.status = 'ending' then
    return jsonb_build_object('ok', true, 'state', 'ending');
  end if;
  -- 턴 처리 중
  if v_session.operation_token is not null then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('user_text', user_text, 'reply', reply, 'correction', correction)
           order by turn_no), '[]')
    into v_turns
    from public.chat_turns
   where session_id = p_session_id and user_id = p_user_id and status = 'done';

  if jsonb_array_length(v_turns) = 0 then
    update public.chat_sessions
       set status = 'ended', feedback_status = 'skipped', ended_at = now()
     where id = p_session_id and user_id = p_user_id;
    return jsonb_build_object('ok', true, 'state', 'ended', 'feedback_status', 'skipped', 'feedback', null);
  end if;

  -- 새 AI 호출만 막는다. 새 실패로 세지 않으므로 chat_failed를 남기지 않는다
  if public.chat_failure_limit_reached(p_user_id) then
    return jsonb_build_object('ok', true, 'state', 'ended', 'feedback_status', 'fallback',
      'feedback', public.end_chat_with_fallback(p_user_id, p_session_id));
  end if;

  v_token := gen_random_uuid();
  update public.chat_sessions
     set status = 'ending',
         feedback_status = 'pending',
         operation_token = v_token,
         operation_expires_at = now() + interval '90 seconds'
   where id = p_session_id and user_id = p_user_id;
  return jsonb_build_object(
    'ok', true,
    'state', 'reserved',
    'token', v_token,
    'language', v_session.language,
    'level', v_session.level,
    'scenario_id', v_session.scenario_id,
    'turns', v_turns);
end;
$$;

-- 종료 완료. 기한이 지난 토큰은 위 복구에서 대체 피드백으로 끝나므로 CONFLICT가 된다
create function public.finish_end(p_user_id uuid, p_session_id uuid, p_token uuid, p_feedback jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  perform public.recover_expired_operations(p_user_id);
  select * into v_session from public.chat_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_session.status <> 'ending' or v_session.operation_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  update public.chat_sessions
     set status = 'ended',
         feedback_status = 'ready',
         feedback = p_feedback,
         ended_at = now(),
         operation_token = null,
         operation_expires_at = null
   where id = p_session_id and user_id = p_user_id;
  return jsonb_build_object('ok', true, 'feedback_status', 'ready', 'feedback', p_feedback);
end;
$$;

-- 피드백 생성 실패. 대체 피드백으로 끝낸다
create function public.fail_end(p_user_id uuid, p_session_id uuid, p_token uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_feedback jsonb;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  perform public.recover_expired_operations(p_user_id);
  select * into v_session from public.chat_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_session.status <> 'ending' or v_session.operation_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  v_feedback := public.end_chat_with_fallback(p_user_id, p_session_id);
  perform public.record_chat_failed(p_user_id, p_token, 'feedback', p_reason);
  return jsonb_build_object('ok', true, 'feedback_status', 'fallback', 'feedback', v_feedback);
end;
$$;

-- 함수 실행 권한: service_role만 ----------------------------------------

revoke execute on function public.kst_today_start() from public, anon, authenticated;
grant execute on function public.kst_today_start() to service_role;
revoke execute on function public.current_plan(uuid) from public, anon, authenticated;
grant execute on function public.current_plan(uuid) to service_role;
revoke execute on function public.chat_turn_limit(uuid) from public, anon, authenticated;
grant execute on function public.chat_turn_limit(uuid) to service_role;
revoke execute on function public.chat_failure_limit_reached(uuid) from public, anon, authenticated;
grant execute on function public.chat_failure_limit_reached(uuid) to service_role;
revoke execute on function public.record_limit_reached(uuid, text) from public, anon, authenticated;
grant execute on function public.record_limit_reached(uuid, text) to service_role;
revoke execute on function public.record_chat_failed(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_chat_failed(uuid, uuid, text, text) to service_role;
revoke execute on function public.end_chat_with_fallback(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_chat_with_fallback(uuid, uuid) to service_role;
revoke execute on function public.recover_expired_operations(uuid) from public, anon, authenticated;
grant execute on function public.recover_expired_operations(uuid) to service_role;
revoke execute on function public.create_chat_session(uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.create_chat_session(uuid, text, int, text) to service_role;
revoke execute on function public.begin_chat_turn(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_chat_turn(uuid, uuid, text) to service_role;
revoke execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb) to service_role;
revoke execute on function public.fail_chat_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_chat_turn(uuid, uuid, uuid, text) to service_role;
revoke execute on function public.begin_end(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_end(uuid, uuid) to service_role;
revoke execute on function public.finish_end(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_end(uuid, uuid, uuid, jsonb) to service_role;
revoke execute on function public.fail_end(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_end(uuid, uuid, uuid, text) to service_role;
