-- 일본어 한글 발음 (spec/chat.md "한글 발음", ADR-015)
--
-- 단어는 데이터에 미리 만든 발음을, 대화 턴은 일본어 입문~중급에서 AI가 만든 발음을 저장한다.
-- 영어·상급 이상·기능을 넣기 전의 턴은 null이다. 교정 발음은 correction jsonb 안의 corrected_pron_ko다.

alter table public.words
  add column pron_ko text,
  add column example_pron_ko text;

alter table public.chat_turns
  add column reply_pron_ko text;

drop function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb);

-- 턴 성공 확정. 기한이 지난 토큰은 위 복구에서 풀리므로 불일치(CONFLICT)가 된다.
-- p_reply_pron_ko는 발음이 없는 턴(영어·상급 이상)에서 빼고 부를 수 있게 마지막 인자이고 기본값이 null이다
create function public.finish_chat_turn(
  p_user_id uuid, p_session_id uuid, p_token uuid, p_reply text, p_reply_ko text, p_correction jsonb,
  p_reply_pron_ko text default null)
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
     set status = 'done', reply = p_reply, reply_ko = p_reply_ko, reply_pron_ko = p_reply_pron_ko,
         correction = p_correction
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

revoke execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text) to service_role;
