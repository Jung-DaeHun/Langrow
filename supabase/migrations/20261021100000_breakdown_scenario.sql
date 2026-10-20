-- 문장 뜯어보기 시작 RPC가 세션의 상황 id도 돌려준다(spec/chat.md "처음 열 때 만들기", ADR-027)
--
-- 2026-10-21 실측에서 문장만 보낸 뜯어보기가 카페 교정 문장의 アイスを를 "아이스크림을"로 옮겼다.
-- use-case가 상황 id로 상황 이름을 찾아 프롬프트에 넣는다. 시그니처는 그대로이고 응답 jsonb에 scenario_id만 더한다.
-- 본문은 20261020100000_breakdown_on_open과 같다. 함수 규칙은 schema 마이그레이션 머리말과 같다.

create or replace function public.begin_turn_breakdown(p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text)
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
    'scenario_id', v_session.scenario_id,
    'until', v_until);
end;
$$;

revoke execute on function public.begin_turn_breakdown(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.begin_turn_breakdown(uuid, uuid, int, text) to service_role;
