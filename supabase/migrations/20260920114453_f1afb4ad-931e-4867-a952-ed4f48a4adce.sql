alter table public.call_queue
  add column if not exists country text not null default '',
  add column if not exists age int,
  add column if not exists topic text not null default '',
  add column if not exists partner_country text not null default '',
  add column if not exists partner_age int,
  add column if not exists partner_topic text not null default '';

drop function if exists public.join_call_queue(text);

create or replace function public.join_call_queue(
  p_nickname text,
  p_country text default '',
  p_age int default null,
  p_topic text default ''
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner public.call_queue;
  v_room uuid;
  v_id uuid;
  v_nick text := coalesce(nullif(trim(p_nickname), ''), 'Guest');
begin
  delete from public.call_queue where created_at < now() - interval '3 minutes';

  select * into v_partner
  from public.call_queue
  where room_id is null
  order by created_at
  limit 1
  for update skip locked;

  if v_partner.id is not null then
    v_room := gen_random_uuid();
    update public.call_queue
      set room_id = v_room,
          partner_nickname = v_nick,
          call_role = 'caller',
          partner_country = coalesce(p_country, ''),
          partner_age = p_age,
          partner_topic = coalesce(p_topic, '')
      where id = v_partner.id;
    insert into public.call_queue (nickname, country, age, topic, room_id, partner_nickname, call_role, partner_country, partner_age, partner_topic)
      values (v_nick, coalesce(p_country, ''), p_age, coalesce(p_topic, ''), v_room, v_partner.nickname, 'callee', v_partner.country, v_partner.age, v_partner.topic)
      returning id into v_id;
    return json_build_object('id', v_id, 'matched', true, 'room_id', v_room,
      'call_role', 'callee', 'partner_nickname', v_partner.nickname,
      'partner_country', v_partner.country, 'partner_age', v_partner.age, 'partner_topic', v_partner.topic);
  end if;

  insert into public.call_queue (nickname, country, age, topic)
    values (v_nick, coalesce(p_country, ''), p_age, coalesce(p_topic, ''))
    returning id into v_id;
  return json_build_object('id', v_id, 'matched', false);
end;
$function$;

create or replace function public.check_call_match(p_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.call_queue;
begin
  select * into v_row from public.call_queue where id = p_id;
  if v_row.id is null then
    return json_build_object('matched', false, 'expired', true);
  end if;
  if v_row.room_id is null then
    return json_build_object('matched', false, 'expired', false);
  end if;
  return json_build_object('matched', true, 'room_id', v_row.room_id,
    'call_role', v_row.call_role, 'partner_nickname', v_row.partner_nickname,
    'partner_country', v_row.partner_country, 'partner_age', v_row.partner_age, 'partner_topic', v_row.partner_topic);
end;
$function$;

grant execute on function public.join_call_queue(text, text, int, text) to anon, authenticated;
grant execute on function public.check_call_match(uuid) to anon, authenticated;