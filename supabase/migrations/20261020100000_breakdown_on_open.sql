-- 문장 뜯어보기를 처음 열 때 만들기: "만드는 중" 기한 열, 시작·실패·저장 RPC
-- (spec/chat.md "처음 열 때 만들기", ADR-027, spec/backend.md "데이터 접근과 보안")
--
-- 함수 규칙은 schema 마이그레이션 머리말과 같다. 세 RPC 모두 먼저 profiles를 FOR UPDATE로 잠근다.
-- 시작 RPC는 이어서 턴 행을 잠근다. 같은 문장의 동시 시작은 이 잠금과 기한으로 하나만 started가 된다.
-- Claude 호출은 시작과 실패·저장 사이에서 use-case가 한다. RPC는 잠금을 쥔 채 기다리지 않는다.
-- 저장본은 reply_breakdown 열과 correction jsonb 안의 breakdown이다(20261017100000_breakdown). SQL null과
-- jsonb null(턴마다 만들던 때 검사에 맞지 않은 값)은 모두 저장본이 아니다.
--
-- 상수
-- - "만드는 중" 기한 90초 (대화 작업 기한과 같다). 지난 기한은 없는 것으로 보고 따로 정리하지 않는다
-- - 하루 AI 실패 10회는 대화와 같은 chat_failure_limit_reached로 본다

-- 열 -------------------------------------------------------------------

-- 그 문장의 뜯어보기를 만드는 중인 기한. 시작 RPC가 DB 시각 + 90초로 저장하고, 실패·저장 RPC가 그 값일 때만 지운다
alter table public.chat_turns
  add column reply_breakdown_until timestamptz,
  add column corrected_breakdown_until timestamptz;

-- RPC ------------------------------------------------------------------

-- 시작. state: stored(저장본, AI를 부르지 않는다) | started(문장·세션 언어·레벨·기한, use-case가 AI를 부른다).
-- 세션 상태와 상관없이 그 세션의 done 턴이면 된다. 저장본은 실패 한도·만드는 중보다 먼저 돌려준다
create function public.begin_turn_breakdown(p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_turn public.chat_turns;
  v_code text;
  v_stored jsonb;
  v_until timestamptz;
begin
  perform 1 from public.profiles where id = p_user_id for update;

  if p_target is null or p_target not in ('reply', 'corrected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into v_session from public.chat_sessions where id = p_session_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  v_code := public.check_readiness(p_user_id, 'ready', v_session.language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  select * into v_turn from public.chat_turns
   where session_id = p_session_id and user_id = p_user_id and turn_no = p_turn_no and status = 'done'
     for update;
  if not found or (p_target = 'corrected' and coalesce(jsonb_typeof(v_turn.correction), 'null') = 'null') then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_stored := case p_target when 'reply' then v_turn.reply_breakdown else v_turn.correction -> 'breakdown' end;
  if coalesce(jsonb_typeof(v_stored), 'null') <> 'null' then
    return jsonb_build_object('ok', true, 'state', 'stored', 'breakdown', v_stored);
  end if;

  -- 저장본이 없을 때만 AI를 부르므로 여기서 실패 한도를 본다
  if public.chat_failure_limit_reached(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'AI_FAILURE_LIMIT');
  end if;
  if (case p_target when 'reply' then v_turn.reply_breakdown_until else v_turn.corrected_breakdown_until end)
     > now() then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  v_until := now() + interval '90 seconds';
  if p_target = 'reply' then
    update public.chat_turns set reply_breakdown_until = v_until where id = v_turn.id and user_id = p_user_id;
  else
    update public.chat_turns set corrected_breakdown_until = v_until where id = v_turn.id and user_id = p_user_id;
  end if;
  return jsonb_build_object(
    'ok', true,
    'state', 'started',
    'sentence', case p_target when 'reply' then v_turn.reply else v_turn.correction ->> 'corrected' end,
    'language', v_session.language,
    'level', v_session.level,
    'until', v_until);
end;
$$;

-- AI 생성 실패. 기한이 시작 RPC가 준 값일 때만 지우고, 지웠을 때만 chat_failed를 남긴다.
-- 두 번 불렀거나, 기한이 지나 다른 요청이 가져갔거나, 남의 턴이면 아무것도 바꾸지 않고 성공한다
create function public.fail_turn_breakdown(
  p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text, p_until timestamptz, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;

  if p_target is null or p_target not in ('reply', 'corrected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if p_target = 'reply' then
    update public.chat_turns set reply_breakdown_until = null
     where session_id = p_session_id and user_id = p_user_id and turn_no = p_turn_no
       and reply_breakdown_until = p_until;
  else
    update public.chat_turns set corrected_breakdown_until = null
     where session_id = p_session_id and user_id = p_user_id and turn_no = p_turn_no
       and corrected_breakdown_until = p_until;
  end if;
  if found then
    perform public.record_chat_failed(p_user_id, null, 'breakdown', p_reason);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- AI 생성 성공. 값이 아직 없을 때만 저장하고(기한이 지난 뒤 늦게 온 성공도), 기한이 시작 RPC가 준 값일 때만 지운다.
-- 저장된 값(먼저 저장된 것이 있으면 그것)을 돌려준다. 교정은 correction의 다른 키를 바꾸지 않는다
create function public.save_turn_breakdown(
  p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text, p_until timestamptz, p_breakdown jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_turn public.chat_turns;
  v_stored jsonb;
begin
  perform 1 from public.profiles where id = p_user_id for update;

  if p_target is null or p_target not in ('reply', 'corrected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into v_turn from public.chat_turns
   where session_id = p_session_id and user_id = p_user_id and turn_no = p_turn_no and status = 'done'
     for update;
  if not found or (p_target = 'corrected' and coalesce(jsonb_typeof(v_turn.correction), 'null') = 'null') then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_stored := case p_target when 'reply' then v_turn.reply_breakdown else v_turn.correction -> 'breakdown' end;
  if coalesce(jsonb_typeof(v_stored), 'null') = 'null' then
    v_stored := p_breakdown;
  end if;

  if p_target = 'reply' then
    update public.chat_turns
       set reply_breakdown = v_stored,
           reply_breakdown_until = case when reply_breakdown_until = p_until then null else reply_breakdown_until end
     where id = v_turn.id and user_id = p_user_id;
  else
    update public.chat_turns
       set correction = correction || jsonb_build_object('breakdown', v_stored),
           corrected_breakdown_until =
             case when corrected_breakdown_until = p_until then null else corrected_breakdown_until end
     where id = v_turn.id and user_id = p_user_id;
  end if;
  return jsonb_build_object('ok', true, 'breakdown', v_stored);
end;
$$;

-- 함수 실행 권한: service_role만 ----------------------------------------

revoke execute on function public.begin_turn_breakdown(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.begin_turn_breakdown(uuid, uuid, int, text) to service_role;
revoke execute on function public.fail_turn_breakdown(uuid, uuid, int, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.fail_turn_breakdown(uuid, uuid, int, text, timestamptz, text) to service_role;
revoke execute on function public.save_turn_breakdown(uuid, uuid, int, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_turn_breakdown(uuid, uuid, int, text, timestamptz, jsonb) to service_role;
