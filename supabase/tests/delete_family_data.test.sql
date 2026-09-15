-- PGM-12: smoke test de delete_family_data() -- confirmación explícita, cascada completa y
-- aislamiento por familia.
--
-- Verifica los invariantes no negociables de esta issue (ALTO RIESGO -- borrado irreversible):
--   1) Confirmación: sin p_confirm = true exacto, y sin p_family_name_confirmation exacto,
--      la función rechaza el borrado y NO toca ninguna fila.
--   2) Autorización: un no-miembro no puede borrar la familia (insufficient_privilege), y
--      CUALQUIER miembro (no solo `families.created_by`) sí puede -- este test borra como
--      user_a2, que es 'cuidador' (no el creador de la familia).
--   3) Cascada completa: TODO lo relacionado a la familia desaparece -- family_members,
--      family_invitations, cared_persons, medical_contacts, emergency_contacts, medications,
--      medication_logs, shifts, shift_handovers.
--   4) Aislamiento: una familia ajena (Familia B) y sus datos quedan absolutamente intactos.
--   5) Exclusión deliberada: push_tokens del usuario que ejecuta el borrado NO se tocan (no
--      son datos de la familia, ver nota de alcance en la migración).
--   6) El resumen devuelto (deleted_counts) refleja exactamente lo que había antes de borrar.
--
-- NOTA DE ALCANCE -- por qué el fixture inserta como `postgres`:
-- Mismo criterio que supabase/tests/export_family_data.test.sql (PGM-11): el fixture se crea
-- como `postgres` (bypassa RLS) para no depender de las RPCs de escritura de cada feature.
-- El comportamiento bajo prueba es exclusivamente delete_family_data(), invocada como
-- `authenticated`.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere app.settings.encryption_key seteada en esta sesión de Postgres (igual que
--       export_family_data.test.sql) -- el fixture cifra condition_notes/medications/etc. ***
--   npm run test:delete-family-data
--
-- Requisitos de la corrida (mismo patrón que los demás tests de este proyecto):
--   * Corre contra el Postgres local de Supabase (`supabase db query --local`), nunca contra
--     staging/prod -- este test literalmente borra filas.
--   * Todo el test vive en un único bloque `do $$ ... $$`, con limpieza explícita del
--     fixture al final -- tanto en el camino feliz como en el bloque `exception`.
--   * Si una aserción falla, el bloque hace `raise exception`, exit code != 0.
--   * Los fixtures usan UUIDs fijos que no deberían colisionar con datos reales.

do $$
declare
  user_a constant uuid := 'c1111111-1111-1111-1111-111111111111'; -- admin/creador, familia A
  user_a2 constant uuid := 'c1121111-1111-1111-1111-111111111111'; -- cuidador, NO creador, familia A
  user_b constant uuid := 'c2222222-2222-2222-2222-222222222222'; -- admin, familia B (ajena)
  family_a constant uuid := 'c8111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'c8222222-2222-2222-2222-222222222222';
  family_a_name constant text := 'Familia Borrable A';
  cared_a constant uuid := 'c8311111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'c8322222-2222-2222-2222-222222222222';
  medical_contact_a constant uuid := 'c8341111-1111-1111-1111-111111111111';
  emergency_contact_a constant uuid := 'c8351111-1111-1111-1111-111111111111';
  medication_a constant uuid := 'c8361111-1111-1111-1111-111111111111';
  medication_log_a constant uuid := 'c8371111-1111-1111-1111-111111111111';
  invitation_a constant uuid := 'c8381111-1111-1111-1111-111111111111';
  shift_a constant uuid := 'c8411111-1111-1111-1111-111111111111'; -- con handover
  shift_a2 constant uuid := 'c8421111-1111-1111-1111-111111111111'; -- sin handover
  shift_b constant uuid := 'c8422222-2222-2222-2222-222222222222';
  handover_a constant uuid := 'c8511111-1111-1111-1111-111111111111';
  push_token_a2 constant uuid := 'c8611111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_matched int;
begin
  -- 1) Fixture (bypassa RLS, corre como postgres).
  insert into auth.users (id) values (user_a), (user_a2), (user_b);

  insert into families (id, name, created_by) values
    (family_a, family_a_name, user_a),
    (family_b, 'Familia Intacta B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_a2, 'cuidador'),
    (family_b, user_b, 'admin');

  insert into family_invitations (id, family_id, invited_email, created_by, expires_at) values
    (invitation_a, family_a, 'invitado@example.com', user_a, now() + interval '7 days');

  insert into cared_persons (id, family_id, full_name, consent_given_at, condition_notes, created_by) values
    (cared_a, family_a, 'Persona cuidada A', now(), extensions.encrypt_text('Hipertensión'), user_a),
    (cared_b, family_b, 'Persona cuidada B', now(), null, user_b);

  insert into medical_contacts (id, cared_person_id, full_name, specialty, phone, created_by) values
    (medical_contact_a, cared_a, 'Dr. House', 'Clínico', '555-1234', user_a);

  insert into emergency_contacts (id, cared_person_id, full_name, relationship, phone, created_by) values
    (emergency_contact_a, cared_a, 'Hija de Persona A', 'Hija', '555-5678', user_a);

  insert into medications (id, cared_person_id, name, dose, instructions, schedule, created_by) values
    (medication_a, cared_a, extensions.encrypt_text('Enalapril'), extensions.encrypt_text('10mg'),
      extensions.encrypt_text('Con el desayuno'), 'cada 12 horas', user_a);

  insert into medication_logs (id, medication_id, taken_by, taken_at, note) values
    (medication_log_a, medication_a, user_a2, now() - interval '1 hour', extensions.encrypt_text('Tomó sin problema'));

  insert into shifts (id, family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by) values
    (shift_a, family_a, cared_a, user_a, now() - interval '8 hours', now(), user_a),
    (shift_a2, family_a, cared_a, user_a2, now(), now() + interval '8 hours', user_a2),
    (shift_b, family_b, cared_b, user_b, now() - interval '8 hours', now(), user_b);

  insert into shift_handovers (id, shift_id, resumen, comida, animo, pendientes, created_by) values
    (handover_a, shift_a, extensions.encrypt_text('Turno tranquilo'), extensions.encrypt_text('Comió todo'),
      extensions.encrypt_text('De buen humor'), extensions.encrypt_text('Renovar receta'), user_a);

  -- push_token de user_a2 -- NO tiene family_id (pertenece al usuario), debe sobrevivir al
  -- borrado de family_a aunque user_a2 sea miembro de esa familia.
  insert into push_tokens (id, user_id, device, expo_token, platform) values
    (push_token_a2, user_a2, 'device-a2', 'ExponentPushToken[fixture-a2]', 'android');

  -- 2) A partir de acá actuamos como `authenticated`, logueados como user_b (familia B,
  --    ajena) para probar el rechazo por falta de membresía ANTES de tocar nada de familia A.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_b::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_b then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_b;
  end if;

  -- 3) Rechazo: user_b (ajeno a family_a) no puede borrarla.
  begin
    perform delete_family_data(family_a, true, family_a_name);
    raise exception 'FALLO RLS: user_b (ajeno) pudo invocar delete_family_data sobre family_a';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  -- 4) A partir de acá actuamos como user_a2 -- MIEMBRO de family_a pero NO su creador
  --    (families.created_by = user_a). Esto prueba explícitamente que el borrado no está
  --    restringido al creador (a diferencia de la RLS `families_delete_own` que sí lo
  --    restringiría bajo `security invoker`).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a2::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a2 then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a2;
  end if;

  -- 5) p_family_id null: debe rechazar con invalid_parameter_value.
  begin
    perform delete_family_data(null, true, family_a_name);
    raise exception 'FALLO: delete_family_data(null, ...) no lanzó excepción';
  exception
    when invalid_parameter_value then
      null; -- esperado.
  end;

  -- 6) Capa de confirmación 1: p_confirm = false debe rechazar SIN borrar nada.
  begin
    perform delete_family_data(family_a, false, family_a_name);
    raise exception 'FALLO: delete_family_data con p_confirm = false no lanzó excepción';
  exception
    when invalid_parameter_value then
      null; -- esperado.
  end;

  select count(*) into v_matched from families where id = family_a;
  if v_matched <> 1 then
    raise exception 'FALLO: family_a fue borrada pese a p_confirm = false (filas restantes: %)', v_matched;
  end if;

  -- 7) Capa de confirmación 2: p_confirm = true pero nombre incorrecto debe rechazar SIN
  --    borrar nada -- prueba que p_confirm = true NO alcanza por sí solo.
  begin
    perform delete_family_data(family_a, true, 'Nombre Incorrecto');
    raise exception 'FALLO: delete_family_data con nombre incorrecto no lanzó excepción';
  exception
    when invalid_parameter_value then
      null; -- esperado.
  end;

  select count(*) into v_matched from families where id = family_a;
  if v_matched <> 1 then
    raise exception 'FALLO: family_a fue borrada pese a nombre de confirmación incorrecto (filas restantes: %)', v_matched;
  end if;

  -- 8) Camino feliz: ambas confirmaciones correctas, invocado por un miembro no-creador.
  select delete_family_data(family_a, true, family_a_name) into v_result;

  if v_result is null then
    raise exception 'FALLO: delete_family_data devolvió null en el camino feliz';
  end if;

  if (v_result ->> 'deleted_family_id')::uuid is distinct from family_a then
    raise exception 'FALLO: deleted_family_id no coincide (obtuvo: %)', v_result ->> 'deleted_family_id';
  end if;

  if (v_result ->> 'deleted_family_name') is distinct from family_a_name then
    raise exception 'FALLO: deleted_family_name no coincide (obtuvo: %)', v_result ->> 'deleted_family_name';
  end if;

  -- 9) deleted_counts refleja exactamente el fixture insertado.
  if (v_result -> 'deleted_counts' ->> 'family_members')::int is distinct from 2 then
    raise exception 'FALLO CONTEO: family_members esperado 2, obtuvo %', v_result -> 'deleted_counts' ->> 'family_members';
  end if;
  if (v_result -> 'deleted_counts' ->> 'family_invitations')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: family_invitations esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'family_invitations';
  end if;
  if (v_result -> 'deleted_counts' ->> 'cared_persons')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: cared_persons esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'cared_persons';
  end if;
  if (v_result -> 'deleted_counts' ->> 'medical_contacts')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: medical_contacts esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'medical_contacts';
  end if;
  if (v_result -> 'deleted_counts' ->> 'emergency_contacts')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: emergency_contacts esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'emergency_contacts';
  end if;
  if (v_result -> 'deleted_counts' ->> 'medications')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: medications esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'medications';
  end if;
  if (v_result -> 'deleted_counts' ->> 'medication_logs')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: medication_logs esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'medication_logs';
  end if;
  if (v_result -> 'deleted_counts' ->> 'shifts')::int is distinct from 2 then
    raise exception 'FALLO CONTEO: shifts esperado 2, obtuvo %', v_result -> 'deleted_counts' ->> 'shifts';
  end if;
  if (v_result -> 'deleted_counts' ->> 'shift_handovers')::int is distinct from 1 then
    raise exception 'FALLO CONTEO: shift_handovers esperado 1, obtuvo %', v_result -> 'deleted_counts' ->> 'shift_handovers';
  end if;

  -- 10) Verificación de cascada completa -- se vuelve a `postgres` (bypassa RLS) para que
  --     "0 filas" pruebe que la fila ya NO EXISTE, no que RLS la esconde (control real de
  --     borrado, no de aislamiento).
  reset role;

  select count(*) into v_matched from families where id = family_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: families sigue teniendo family_a'; end if;

  select count(*) into v_matched from family_members where family_id = family_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: family_members sigue teniendo filas de family_a'; end if;

  select count(*) into v_matched from family_invitations where family_id = family_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: family_invitations sigue teniendo filas de family_a'; end if;

  select count(*) into v_matched from cared_persons where id = cared_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: cared_persons (cared_a) no fue borrada'; end if;

  select count(*) into v_matched from medical_contacts where id = medical_contact_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: medical_contacts (de cared_a) no fue borrado'; end if;

  select count(*) into v_matched from emergency_contacts where id = emergency_contact_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: emergency_contacts (de cared_a) no fue borrado'; end if;

  select count(*) into v_matched from medications where id = medication_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: medications (de cared_a) no fue borrada'; end if;

  select count(*) into v_matched from medication_logs where id = medication_log_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: medication_logs (de medication_a) no fue borrado'; end if;

  select count(*) into v_matched from shifts where id in (shift_a, shift_a2);
  if v_matched <> 0 then raise exception 'FALLO CASCADA: shifts de family_a no fueron borrados'; end if;

  select count(*) into v_matched from shift_handovers where id = handover_a;
  if v_matched <> 0 then raise exception 'FALLO CASCADA: shift_handovers (handover_a) no fue borrado'; end if;

  -- 11) Exclusión deliberada: el push_token de user_a2 (miembro de la familia borrada)
  --     SOBREVIVE -- no es un dato de la familia, ver nota de alcance en la migración.
  select count(*) into v_matched from push_tokens where id = push_token_a2;
  if v_matched <> 1 then
    raise exception 'FALLO: push_tokens de user_a2 fue borrado (no debería -- no pertenece a la familia)';
  end if;

  -- 12) Aislamiento: la Familia B (ajena) y TODOS sus datos quedan absolutamente intactos.
  select count(*) into v_matched from families where id = family_b;
  if v_matched <> 1 then raise exception 'FALLO AISLAMIENTO: family_b fue afectada'; end if;

  select count(*) into v_matched from family_members where family_id = family_b;
  if v_matched <> 1 then raise exception 'FALLO AISLAMIENTO: family_members de family_b fue afectada'; end if;

  select count(*) into v_matched from cared_persons where id = cared_b;
  if v_matched <> 1 then raise exception 'FALLO AISLAMIENTO: cared_persons (cared_b) fue afectada'; end if;

  select count(*) into v_matched from shifts where id = shift_b;
  if v_matched <> 1 then raise exception 'FALLO AISLAMIENTO: shifts (shift_b) fue afectado'; end if;

  raise notice 'PGM-12 delete_family_data smoke test: OK (confirmación, cascada completa, exclusiones y aislamiento verificados)';

  -- 13) Limpieza del fixture (camino feliz) -- solo queda por borrar lo de family_b y el
  --     push_token de user_a2 (family_a ya la borró la propia función bajo prueba).
  delete from shift_handovers where shift_id = shift_b;
  delete from shifts where id = shift_b;
  delete from medications where cared_person_id = cared_b;
  delete from medical_contacts where cared_person_id = cared_b;
  delete from emergency_contacts where cared_person_id = cared_b;
  delete from cared_persons where id = cared_b;
  delete from family_members where family_id = family_b;
  delete from families where id = family_b;
  delete from push_tokens where id = push_token_a2;
  delete from auth.users where id in (user_a, user_a2, user_b);

exception
  when others then
    reset role;
    delete from shift_handovers where shift_id in (shift_a, shift_a2, shift_b);
    delete from medication_logs where medication_id = medication_a;
    delete from medications where cared_person_id in (cared_a, cared_b);
    delete from medical_contacts where cared_person_id in (cared_a, cared_b);
    delete from emergency_contacts where cared_person_id in (cared_a, cared_b);
    delete from shifts where family_id in (family_a, family_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_invitations where family_id in (family_a, family_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from push_tokens where id = push_token_a2;
    delete from auth.users where id in (user_a, user_a2, user_b);
    raise;
end $$;
