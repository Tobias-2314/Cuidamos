-- PGM-34: smoke test del ÚNICO artefacto de esta issue -- get_medications_never_logged().
-- Ver nota de diagnóstico extensa en
-- supabase/migrations/20260916130000_medications_never_logged.sql: esta función es un
-- PROXY DÉBIL ("nunca tuvo ningún medication_log") y NO resuelve "no marcada a tiempo
-- respecto de un horario" -- eso sigue bloqueado por medications.schedule siendo texto
-- libre a propósito (YAGNI de PGM-30).
--
-- Cubre los invariantes no negociables de esta función:
--   1) Una medicación creada hace más de p_min_age y SIN ningún medication_log SÍ aparece.
--   2) Una medicación con al menos un medication_log (aunque sea viejo) NO aparece --
--      incluida la advertencia de diseño: una vez que tiene un log, no vuelve a aparecer.
--   3) Una medicación creada hace MENOS de p_min_age NO aparece todavía (margen explícito
--      del llamador, no asume nada sobre `schedule`).
--   4) La función es `security definer` con grant SOLO a `service_role` -- un cliente
--      autenticado común debe recibir insufficient_privilege (mismo patrón de permisos que
--      get_shifts_needing_upcoming_reminder(), PGM-29).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres (medications.name/dose son NOT NULL y cifrados) -- ver sección 2 de
--       supabase/migrations/20260913210000_encryption_helpers.sql y el paso manual en el
--       README. ***
--   npm run test:medications-never-logged
--
-- Mismas convenciones que el resto de este proyecto: un único bloque `do $$ ... $$`,
-- limpieza explícita en el camino feliz y en `exception`, UUIDs fijos con prefijo 96/a96
-- (sin colisión con los prefijos ya usados: 81-85/a81-85 medications.test.sql, 91-93
-- push_tokens.test.sql, 94/a94 is_family_member.test.sql, 95/a95
-- shifts_upcoming_reminders.test.sql).

do $$
declare
  user_a constant uuid := '96111111-1111-1111-1111-111111111111';
  family_a constant uuid := 'a9611111-1111-1111-1111-111111111111';
  cared_a constant uuid := 'a9612222-2222-2222-2222-222222222222';

  med_never_logged constant uuid := 'a9621111-1111-1111-1111-111111111111'; -- vieja, sin ningún log -- debe calificar
  med_has_log constant uuid := 'a9622222-2222-2222-2222-222222222222'; -- vieja, con un log viejo -- NO debe calificar
  med_too_new constant uuid := 'a9623333-3333-3333-3333-333333333333'; -- recién creada, sin log -- NO debe calificar todavía

  matched int;
  raised_sqlstate text;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS).
  insert into auth.users (id) values (user_a);
  insert into families (id, name, created_by) values (family_a, 'Familia A', user_a);
  insert into family_members (family_id, user_id, role) values (family_a, user_a, 'admin');
  insert into cared_persons (id, family_id, full_name, created_by, consent_given_at) values
    (cared_a, family_a, 'Persona Cuidada A', user_a, now());

  insert into medications (id, cared_person_id, name, dose, schedule, created_by, created_at) values
    (med_never_logged, cared_a, extensions.encrypt_text('Ibuprofeno'), extensions.encrypt_text('400mg'), 'cada 8 horas', user_a, now() - interval '10 days'),
    (med_has_log, cared_a, extensions.encrypt_text('Paracetamol'), extensions.encrypt_text('500mg'), 'cada 8 horas', user_a, now() - interval '10 days'),
    (med_too_new, cared_a, extensions.encrypt_text('Amoxicilina'), extensions.encrypt_text('250mg'), 'cada 12 horas', user_a, now() - interval '1 minute');

  insert into medication_logs (medication_id, taken_by, taken_at, note) values
    (med_has_log, user_a, now() - interval '9 days', extensions.encrypt_text('toma vieja registrada'));

  -- 2) get_medications_never_logged('1 day'): corre como service_role, el rol pensado para
  --    invocar esta función (ver grant en la migración).
  set local role service_role;

  select count(*) into matched
    from get_medications_never_logged(interval '1 day')
    where medication_id = med_never_logged;
  if matched <> 1 then
    raise exception 'FALLO: med_never_logged debería calificar (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_medications_never_logged(interval '1 day')
    where medication_id = med_has_log;
  if matched <> 0 then
    raise exception 'FALLO: med_has_log (con un log, aunque viejo) NO debería calificar (obtuvo % filas)', matched;
  end if;

  select count(*) into matched
    from get_medications_never_logged(interval '1 day')
    where medication_id = med_too_new;
  if matched <> 0 then
    raise exception 'FALLO: med_too_new (creada hace 1 minuto, dentro del margen de 1 día) NO debería calificar todavía (obtuvo % filas)', matched;
  end if;

  -- 3) Con un margen mínimo (0 segundos), med_too_new sí pasa a calificar -- confirma que
  --    p_min_age es un margen explícito del llamador, no un valor hardcodeado.
  select count(*) into matched
    from get_medications_never_logged(interval '0 seconds')
    where medication_id = med_too_new;
  if matched <> 1 then
    raise exception 'FALLO: med_too_new debería calificar con p_min_age = 0 (obtuvo % filas)', matched;
  end if;

  -- 4) La función NO debe ser ejecutable por `authenticated` -- pensada exclusivamente para
  --    la futura Edge Function/cron corriendo con service_role.
  reset role;
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  begin
    perform get_medications_never_logged(interval '1 day');
    raise exception 'FALLO PERMISOS: authenticated pudo ejecutar get_medications_never_logged()';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  raise notice 'PGM-34 medications_never_logged smoke test: OK (proxy débil de "nunca logueada", margen p_min_age y permisos service_role-only verificados)';

  -- 5) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from medication_logs where medication_id in (med_never_logged, med_has_log, med_too_new);
  delete from medications where id in (med_never_logged, med_has_log, med_too_new);
  delete from cared_persons where id = cared_a;
  delete from family_members where family_id = family_a;
  delete from families where id = family_a;
  delete from auth.users where id = user_a;

exception
  when others then
    -- Limpieza del fixture también en el camino de error.
    reset role;
    delete from medication_logs where medication_id in (med_never_logged, med_has_log, med_too_new);
    delete from medications where id in (med_never_logged, med_has_log, med_too_new);
    delete from cared_persons where id = cared_a;
    delete from family_members where family_id = family_a;
    delete from families where id = family_a;
    delete from auth.users where id = user_a;
    raise;
end $$;
