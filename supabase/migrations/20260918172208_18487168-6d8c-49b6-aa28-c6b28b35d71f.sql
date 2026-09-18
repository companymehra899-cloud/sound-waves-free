CREATE TABLE public.call_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text NOT NULL DEFAULT 'Guest',
  room_id uuid,
  partner_nickname text,
  call_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX call_queue_waiting_idx ON public.call_queue (created_at) WHERE room_id IS NULL;

GRANT ALL ON public.call_queue TO service_role;
ALTER TABLE public.call_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.join_call_queue(p_nickname text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner public.call_queue;
  v_room uuid;
  v_id uuid;
  v_nick text := coalesce(nullif(trim(p_nickname), ''), 'Guest');
BEGIN
  DELETE FROM public.call_queue WHERE created_at < now() - interval '3 minutes';

  SELECT * INTO v_partner
  FROM public.call_queue
  WHERE room_id IS NULL
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_partner.id IS NOT NULL THEN
    v_room := gen_random_uuid();
    UPDATE public.call_queue
      SET room_id = v_room, partner_nickname = v_nick, call_role = 'caller'
      WHERE id = v_partner.id;
    INSERT INTO public.call_queue (nickname, room_id, partner_nickname, call_role)
      VALUES (v_nick, v_room, v_partner.nickname, 'callee')
      RETURNING id INTO v_id;
    RETURN json_build_object('id', v_id, 'matched', true, 'room_id', v_room,
      'call_role', 'callee', 'partner_nickname', v_partner.nickname);
  END IF;

  INSERT INTO public.call_queue (nickname) VALUES (v_nick) RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id, 'matched', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_call_match(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.call_queue;
BEGIN
  SELECT * INTO v_row FROM public.call_queue WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN json_build_object('matched', false, 'expired', true);
  END IF;
  IF v_row.room_id IS NULL THEN
    RETURN json_build_object('matched', false, 'expired', false);
  END IF;
  RETURN json_build_object('matched', true, 'room_id', v_row.room_id,
    'call_role', v_row.call_role, 'partner_nickname', v_row.partner_nickname);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_call_queue(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.call_queue WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.join_call_queue(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_call_match(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_call_queue(uuid) TO anon, authenticated;