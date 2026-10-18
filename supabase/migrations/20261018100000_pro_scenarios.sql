-- Pro 상황 (spec/usage.md "Pro 상황", ADR-019)
--
-- 레벨마다 4~7번째 상황은 체험·Pro 사용자만 새 세션을 만들 수 있다. Pro 상황인지는 use-case가
-- lib/scenarios로 정해 p_pro_only로 넘기고, 플랜은 계정을 잠근 뒤 DB 시각(current_plan)으로 정한다.
-- 새 세션만 막는다. 턴·종료 RPC는 플랜을 다시 보지 않는다. 거부는 limit_reached로 남기지 않는다.

drop function public.create_chat_session(uuid, text, int, text);

-- Claude를 부르지 않는다. 상황이 열린 레벨의 것인지는 use-case가 lib/scenarios로 검사한다.
-- p_pro_only는 인자 4개로 부르는 코드와 맞게 마지막 인자이고 기본값이 false다
create function public.create_chat_session(
  p_user_id uuid, p_language text, p_level int, p_scenario_id text, p_pro_only boolean default false)
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

  if p_pro_only and public.current_plan(p_user_id) <> 'pro' then
    return jsonb_build_object('ok', false, 'code', 'PRO_REQUIRED');
  end if;

  insert into public.chat_sessions (user_id, language, level, scenario_id)
    values (p_user_id, p_language, p_level, p_scenario_id)
    returning id into v_session_id;
  return jsonb_build_object('ok', true, 'session_id', v_session_id);
end;
$$;

revoke execute on function public.create_chat_session(uuid, text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.create_chat_session(uuid, text, int, text, boolean) to service_role;
