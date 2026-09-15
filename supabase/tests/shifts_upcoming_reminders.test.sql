-- PGM-29: smoke test de la lógica de "qué turnos califican para recordatorio de turno
-- próximo" -- get_shifts_needing_upcoming_reminder(), mark_shift_reminder_sent() y
-- get_upcoming_shift_reminder_targets(). Ver nota de alcance extensa en
-- supabase/migrations/20260916120000_shifts_upcoming_reminders.sql: esta migración NO
-- envía ningún push, solo deja la lógica de consulta lista para la futura Edge
-- Function/cron.
--
-- Cubre los invariantes no negociables de esta issue:
--   1) Un turno que empieza dentro de la ventana de p_minutes_ahead, en estado 'scheduled'
--      y sin reminder_sent_at, SÍ aparece.
--   2) Un turno muy lejano en el tiempo (fuera de la ventana) NO aparece.
--   3) Un turno ya marcado (reminder_sent_at no nulo) NO reaparece.
--   4) Un turno cancelado, aunque empiece pronto, NO aparece (no tiene sentido avisar de
--      un turno cancelado).
--   5) Un turno que ya empezó (starts_at en el pasado) NO aparece.
--   6) mark_shift_reminder_sent() fija reminder_sent_at = now() y, a partir de ahí, ese
--      turno deja de aparecer en corridas futuras de get_shifts_needing_upcoming_reminder().
--   7) get_upcoming_shift_reminder_targets() junta cada turno calificado con el/los
--      push_tokens de su assigned_to -- LEFT JOIN: un turno sin push_tokens registrados
--      igual aparece, con device/expo_token/platform en NULL.
--   8) Las tres funciones son `security definer` con grant SOLO a `service_role` -- un
--      cliente autenticado común debe recibir insufficient_privilege al intentar llamarlas
--      (no deben quedar accesibles al rol `authenticated`, que es lo que usaría un cliente
--      móvil logueado).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:shifts-upcoming-reminders
--
-- Mismas convenciones que el resto de este proyecto: un único bloque `do $$ ... $$`,
-- limpieza explícita en el camino feliz y en `exception`, UUIDs fijos con prefijo 95/a95
-- (sin colisión con los prefijos ya usados por otros archivos de test: 71-73/a71-73
-- shifts.test.sql, 81-82/a81-85 shift_handovers.test.sql, 91-93 push_tokens.test.sql,
-- 94/a94 is_family_member.test.sql).

do $$
declare
  user_a constant uuid := '95111111-1111-1111-1111-111111111111'; -- tiene push_token registrado
  user_b constant uuid := '95222222-2222-2222-2222-222222222222'; -- sin push_token
  family_a constant uuid := 'a9511111-1111-1111-1111-111111111111';

  shift_soon constant uuid := 'a9521111-1111-1111-1111-111111111111'; -- empieza en 10 min, scheduled, sin avisar -- debe calificar
  shift_far constant uuid := 'a9522222-2222-2222-2222-222222222222'; -- empieza en 5 horas -- no debe calificar
  shift_notified constant uuid := 'a9523333-3333-3333-3333-333333333333'; -- empieza pronto pero ya avisado -- no debe calificar
  shift_cancelled constant uuid := 'a9524444-4444-4444-4444-444444444444'; -- empieza pronto pero cancelado -- no debe calificar
  shift_started constant uuid := 'a9525555-5555-5555-5555-555555555555'; -- ya empezó -- no debe calificar
  shift_no_token constant uuid := 'a9526666-6666-6666-6666-666666666666'; -- empieza pronto, assigned_to sin push_token -- debe calificar (con token NULL)

  matched int;
  target_expo_token text;
  target_device text;
  raised_sqlstate text;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS), una familia con dos miembros reales y varios
  --    turnos cubriendo cada caso.
  insert into auth.users (id) values (user_a), (user_b);

  insert into families (id, name, created_by) values (family_a, 'Familia A', user_a);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_b, 'cuidador');

  insert into push_tokens (user_id, device, expo_token, platform) values
    (user_a, 'device-a-fixture', 'ExponentPushToken[fixture-a]', 'android');
  -- user_b no tiene push_token -- a propósito, para probar el LEFT JOIN.

  insert into shifts (id, family_id, assigned_to, starts_at, ends_at, status, created_by, reminder_sent_at) values
    (shift_soon, family_a, user_a, now() + interval '10 minutes', now() + interval '70 minutes', 'scheduled', user_a, null),
    (shift_far, family_a, user_a, now() + interval '5 hours', now() + interval '6 hours', 'scheduled', user_a, null),
    (shift_notified, family_a, user_b, now() + interval '10 minutes', now() + interval '70 minutes', 'scheduled', user_a, now() - interval '1 minute'),
    (shift_cancelled, family_a, user_a, now() + interval '10 minutes', now() + interval '70 minutes', 'cancelled', user_a, null),
    (shift_started, family_a, user_a, now() - interval '5 minutes', now() + interval '55 minutes', 'scheduled', user_a, null),
    (shift_no_token, family_a, user_b, now() + interval '12 minutes', now() + interval '72 minutes', 'scheduled', user_a, null);

  -- 2) get_shifts_needing_upcoming_reminder(15): deben calificar únicamente shift_soon y
  --    shift_no_token (ventana de 15 minutos). Se corre como `service_role`, el rol
  --    pensado para invocar esta función (ver grant en la migración).
  set local role service_role;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_soon;
  if matched <> 1 then
    raise exception 'FALLO: shift_soon debería calificar para recordatorio (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_no_token;
  if matched <> 1 then
    raise exception 'FALLO: shift_no_token debería calificar para recordatorio (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_far;
  if matched <> 0 then
    raise exception 'FALLO: shift_far (5hs) NO debería calificar dentro de una ventana de 15 min (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_notified;
  if matched <> 0 then
    raise exception 'FALLO: shift_notified (ya avisado) NO debería reaparecer (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_cancelled;
  if matched <> 0 then
    raise exception 'FALLO: shift_cancelled NO debería calificar aunque empiece pronto (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_started;
  if matched <> 0 then
    raise exception 'FALLO: shift_started (ya empezó) NO debería calificar (obtuvo % filas)', matched;
  end if;

  -- 3) p_minutes_ahead <= 0 no debe explotar, solo devolver 0 filas (greatest(...,0)).
  select count(*) into matched from get_shifts_needing_upcoming_reminder(0);
  if matched <> 0 then
    raise exception 'FALLO: get_shifts_needing_upcoming_reminder(0) debería devolver 0 filas (obtuvo %)', matched;
  end if;

  select count(*) into matched from get_shifts_needing_upcoming_reminder(-30);
  if matched <> 0 then
    raise exception 'FALLO: get_shifts_needing_upcoming_reminder(-30) debería devolver 0 filas sin lanzar excepción (obtuvo %)', matched;
  end if;

  -- 4) get_upcoming_shift_reminder_targets(15): shift_soon debe traer el push_token real de
  --    user_a; shift_no_token debe traer device/expo_token en NULL (LEFT JOIN).
  select expo_token, device into target_expo_token, target_device
    from get_upcoming_shift_reminder_targets(15)
    where shift_id = shift_soon;
  if target_expo_token is distinct from 'ExponentPushToken[fixture-a]' then
    raise exception 'FALLO: get_upcoming_shift_reminder_targets() no trajo el expo_token esperado para shift_soon (obtuvo %)', target_expo_token;
  end if;

  select expo_token, device into target_expo_token, target_device
    from get_upcoming_shift_reminder_targets(15)
    where shift_id = shift_no_token;
  if target_expo_token is not null or target_device is not null then
    raise exception 'FALLO LEFT JOIN: shift_no_token debería traer expo_token/device NULL (obtuvo % / %)', target_expo_token, target_device;
  end if;

  select count(*) into matched
    from get_upcoming_shift_reminder_targets(15)
    where shift_id = shift_no_token;
  if matched <> 1 then
    raise exception 'FALLO LEFT JOIN: shift_no_token debería seguir apareciendo aunque no tenga push_token (obtuvo % filas)', matched;
  end if;

  -- 5) mark_shift_reminder_sent(): fija reminder_sent_at y el turno deja de calificar.
  perform mark_shift_reminder_sent(shift_soon);

  reset role;
  select count(*) into matched from shifts where id = shift_soon and reminder_sent_at is not null;
  if matched <> 1 then
    raise exception 'FALLO: mark_shift_reminder_sent() no fijó reminder_sent_at en shift_soon';
  end if;
  set local role service_role;

  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_soon;
  if matched <> 0 then
    raise exception 'FALLO: shift_soon no debería reaparecer tras mark_shift_reminder_sent() (obtuvo % filas)', matched;
  end if;

  -- shift_no_token sigue calificando (no se tocó su reminder_sent_at).
  select count(*) into matched
    from get_shifts_needing_upcoming_reminder(15)
    where shift_id = shift_no_token;
  if matched <> 1 then
    raise exception 'FALLO: shift_no_token debería seguir calificando tras marcar shift_soon (obtuvo % filas)', matched;
  end if;

  -- 6) mark_shift_reminder_sent() con un id inexistente lanza P0002 (no_data_found), no un
  --    no-op silencioso.
  begin
    perform mark_shift_reminder_sent('00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'FALLO: mark_shift_reminder_sent() con id inexistente debería lanzar una excepción';
  exception
    when others then
      get stacked diagnostics raised_sqlstate = returned_sqlstate;
      if raised_sqlstate <> 'P0002' then
        raise exception 'FALLO: mark_shift_reminder_sent() con id inexistente lanzó sqlstate % (esperado P0002)', raised_sqlstate;
      end if;
  end;

  -- 7) Las tres funciones NO deben ser ejecutables por `authenticated` -- están pensadas
  --    exclusivamente para la futura Edge Function/cron corriendo con service_role, nunca
  --    para un cliente logueado como usuario común (ver grant en la migración).
  reset role;
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  begin
    perform get_shifts_needing_upcoming_reminder(15);
    raise exception 'FALLO PERMISOS: authenticated pudo ejecutar get_shifts_needing_upcoming_reminder()';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  begin
    perform get_upcoming_shift_reminder_targets(15);
    raise exception 'FALLO PERMISOS: authenticated pudo ejecutar get_upcoming_shift_reminder_targets()';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  begin
    perform mark_shift_reminder_sent(shift_no_token);
    raise exception 'FALLO PERMISOS: authenticated pudo ejecutar mark_shift_reminder_sent()';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  raise notice 'PGM-29 shifts_upcoming_reminders smoke test: OK (lógica de calificación, mark_shift_reminder_sent(), LEFT JOIN con push_tokens y permisos service_role-only verificados)';

  -- 8) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from shifts where family_id = family_a;
  delete from push_tokens where user_id in (user_a, user_b);
  delete from family_members where family_id = family_a;
  delete from families where id = family_a;
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from shifts where family_id = family_a;
    delete from push_tokens where user_id in (user_a, user_b);
    delete from family_members where family_id = family_a;
    delete from families where id = family_a;
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
