-- PGM-11: smoke test de export_family_data() -- aislamiento por familia, árbol completo y
-- descifrado de los campos de salud.
--
-- Verifica los invariantes no negociables de esta issue:
--   1) Aislamiento: un usuario que NO es miembro de la Familia B no puede exportar sus datos
--      (insufficient_privilege), y el export de la Familia A no contiene ninguna fila de la
--      Familia B.
--   2) Árbol completo: family, members, cared_persons (con medical_contacts,
--      emergency_contacts y medications anidados), medication_logs anidados dentro de su
--      medication, y shifts con su handover anidado (o null si no tiene).
--   3) Descifrado: condition_notes, name/dose/instructions de medications, note de
--      medication_logs y los 4 campos de shift_handovers vuelven en texto plano en el jsonb
--      (nunca como bytea/base64 crudo).
--
-- NOTA DE ALCANCE -- por qué el fixture inserta como `postgres`:
-- Mismo criterio que supabase/tests/shift_handovers.test.sql (PGM-35) y
-- supabase/tests/medications.test.sql (PGM-30): el fixture (incluye cifrado real vía
-- extensions.encrypt_text) se crea como `postgres` (bypassa RLS) para no depender de las
-- RPCs de escritura de cada feature (fuera del alcance de este test). El comportamiento bajo
-- prueba es exclusivamente export_family_data(), invocada como `authenticated`.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README. ***
--   npm run test:export-family-data
--
-- Requisitos de la corrida (mismo patrón que los demás tests de este proyecto):
--   * Corre contra el Postgres local de Supabase (`supabase db query --local`), nunca contra
--     staging/prod.
--   * Todo el test vive en un único bloque `do $$ ... $$` (supabase db query -f solo acepta
--     un statement top-level), con limpieza explícita del fixture al final -- tanto en el
--     camino feliz como en el bloque `exception`.
--   * Si una aserción falla, el bloque hace `raise exception`, lo que hace que
--     `supabase db query` termine con exit code != 0.
--   * Los fixtures usan UUIDs fijos que no deberían colisionar con datos reales de
--     desarrollo; igual se borran siempre al final.

do $$
declare
  user_a constant uuid := 'b1111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_a2 constant uuid := 'b1121111-1111-1111-1111-111111111111'; -- cuidador, también familia A
  user_b constant uuid := 'b2222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  family_a constant uuid := 'b8111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'b8222222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'b8311111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'b8322222-2222-2222-2222-222222222222';
  medical_contact_a constant uuid := 'b8341111-1111-1111-1111-111111111111';
  emergency_contact_a constant uuid := 'b8351111-1111-1111-1111-111111111111';
  medication_a constant uuid := 'b8361111-1111-1111-1111-111111111111';
  medication_log_a constant uuid := 'b8371111-1111-1111-1111-111111111111';
  shift_a constant uuid := 'b8411111-1111-1111-1111-111111111111'; -- con handover
  shift_a2 constant uuid := 'b8421111-1111-1111-1111-111111111111'; -- sin handover
  shift_b constant uuid := 'b8422222-2222-2222-2222-222222222222';
  handover_a constant uuid := 'b8511111-1111-1111-1111-111111111111';
  plain_condition_notes constant text := 'Hipertensión, controlar presión 2 veces por día';
  plain_med_name constant text := 'Enalapril';
  plain_med_dose constant text := '10mg';
  plain_med_instructions constant text := 'Con el desayuno';
  plain_log_note constant text := 'Tomó sin problema';
  plain_resumen constant text := 'Turno tranquilo';
  plain_comida constant text := 'Comió todo';
  plain_animo constant text := 'De buen humor';
  plain_pendientes constant text := 'Renovar receta';
  v_export jsonb;
  v_export_b jsonb;
  v_matched int;
begin
  -- 1) Fixture (bypassa RLS, corre como postgres).
  insert into auth.users (id) values (user_a), (user_a2), (user_b);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_a2, 'cuidador'),
    (family_b, user_b, 'admin');

  insert into cared_persons (id, family_id, full_name, consent_given_at, condition_notes, created_by) values
    (cared_a, family_a, 'Persona cuidada A', now(), extensions.encrypt_text(plain_condition_notes), user_a),
    (cared_b, family_b, 'Persona cuidada B', now(), null, user_b);

  insert into medical_contacts (id, cared_person_id, full_name, specialty, phone, created_by) values
    (medical_contact_a, cared_a, 'Dr. House', 'Clínico', '555-1234', user_a);

  insert into emergency_contacts (id, cared_person_id, full_name, relationship, phone, created_by) values
    (emergency_contact_a, cared_a, 'Hija de Persona A', 'Hija', '555-5678', user_a);

  insert into medications (id, cared_person_id, name, dose, instructions, schedule, created_by) values
    (medication_a, cared_a, extensions.encrypt_text(plain_med_name), extensions.encrypt_text(plain_med_dose),
      extensions.encrypt_text(plain_med_instructions), 'cada 12 horas', user_a);

  insert into medication_logs (id, medication_id, taken_by, taken_at, note) values
    (medication_log_a, medication_a, user_a2, now() - interval '1 hour', extensions.encrypt_text(plain_log_note));

  insert into shifts (id, family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by) values
    (shift_a, family_a, cared_a, user_a, now() - interval '8 hours', now(), user_a),
    (shift_a2, family_a, cared_a, user_a2, now(), now() + interval '8 hours', user_a2),
    (shift_b, family_b, cared_b, user_b, now() - interval '8 hours', now(), user_b);

  insert into shift_handovers (id, shift_id, resumen, comida, animo, pendientes, created_by) values
    (handover_a, shift_a, extensions.encrypt_text(plain_resumen), extensions.encrypt_text(plain_comida),
      extensions.encrypt_text(plain_animo), extensions.encrypt_text(plain_pendientes), user_a);

  -- 2) A partir de acá actuamos como `authenticated`, logueados como user_a (Familia A).
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- 3) Control positivo: user_a puede exportar su propia familia.
  select export_family_data(family_a) into v_export;

  if v_export is null then
    raise exception 'FALLO: export_family_data(family_a) devolvió null';
  end if;

  if (v_export ->> 'family_id')::uuid is distinct from family_a then
    raise exception 'FALLO: family_id del export no coincide (obtuvo: %)', v_export ->> 'family_id';
  end if;

  if (v_export -> 'family' ->> 'name') is distinct from 'Familia A' then
    raise exception 'FALLO: family.name incorrecto (obtuvo: %)', v_export -> 'family' ->> 'name';
  end if;

  -- 4) members: deben aparecer AMBOS miembros de la Familia A (user_a y user_a2), no solo la
  --    fila propia -- este es el punto que específicamente requiere reusar
  --    list_family_members() (security definer) en vez de una subquery directa a
  --    family_members (que bajo RLS se reduciría a la fila propia).
  select jsonb_array_length(v_export -> 'members') into v_matched;
  if v_matched <> 2 then
    raise exception 'FALLO: members debería tener 2 filas (Familia A), obtuvo %', v_matched;
  end if;

  select count(*) into v_matched
  from jsonb_array_elements(v_export -> 'members') el
  where (el ->> 'user_id')::uuid in (user_a, user_a2);
  if v_matched <> 2 then
    raise exception 'FALLO: members no contiene a ambos user_a/user_a2 (matched: %)', v_matched;
  end if;

  -- 5) cared_persons: 1 fila, con condition_notes YA DESCIFRADO en texto plano.
  select jsonb_array_length(v_export -> 'cared_persons') into v_matched;
  if v_matched <> 1 then
    raise exception 'FALLO: cared_persons debería tener 1 fila, obtuvo %', v_matched;
  end if;

  if (v_export -> 'cared_persons' -> 0 ->> 'condition_notes') is distinct from plain_condition_notes then
    raise exception 'FALLO CIFRADO: condition_notes no vino descifrado (obtuvo: %)',
      v_export -> 'cared_persons' -> 0 ->> 'condition_notes';
  end if;

  -- 6) medical_contacts / emergency_contacts anidados bajo la cared_person.
  if (v_export -> 'cared_persons' -> 0 -> 'medical_contacts' -> 0 ->> 'full_name') is distinct from 'Dr. House' then
    raise exception 'FALLO: medical_contacts anidado incorrecto (obtuvo: %)',
      v_export -> 'cared_persons' -> 0 -> 'medical_contacts' -> 0 ->> 'full_name';
  end if;

  if (v_export -> 'cared_persons' -> 0 -> 'emergency_contacts' -> 0 ->> 'full_name') is distinct from 'Hija de Persona A' then
    raise exception 'FALLO: emergency_contacts anidado incorrecto (obtuvo: %)',
      v_export -> 'cared_persons' -> 0 -> 'emergency_contacts' -> 0 ->> 'full_name';
  end if;

  -- 7) medications anidados, descifrados, con su medication_logs anidado y también
  --    descifrado.
  if (v_export -> 'cared_persons' -> 0 -> 'medications' -> 0 ->> 'name') is distinct from plain_med_name then
    raise exception 'FALLO CIFRADO: medications.name no vino descifrado (obtuvo: %)',
      v_export -> 'cared_persons' -> 0 -> 'medications' -> 0 ->> 'name';
  end if;
  if (v_export -> 'cared_persons' -> 0 -> 'medications' -> 0 ->> 'dose') is distinct from plain_med_dose then
    raise exception 'FALLO CIFRADO: medications.dose no vino descifrado';
  end if;
  if (v_export -> 'cared_persons' -> 0 -> 'medications' -> 0 ->> 'instructions') is distinct from plain_med_instructions then
    raise exception 'FALLO CIFRADO: medications.instructions no vino descifrado';
  end if;

  if (v_export -> 'cared_persons' -> 0 -> 'medications' -> 0 -> 'medication_logs' -> 0 ->> 'note')
      is distinct from plain_log_note then
    raise exception 'FALLO CIFRADO: medication_logs.note no vino descifrado (obtuvo: %)',
      v_export -> 'cared_persons' -> 0 -> 'medications' -> 0 -> 'medication_logs' -> 0 ->> 'note';
  end if;

  -- 8) shifts: 2 filas de la Familia A, una con handover (descifrado) y otra con handover
  --    null.
  select jsonb_array_length(v_export -> 'shifts') into v_matched;
  if v_matched <> 2 then
    raise exception 'FALLO: shifts debería tener 2 filas (Familia A), obtuvo %', v_matched;
  end if;

  select count(*) into v_matched
  from jsonb_array_elements(v_export -> 'shifts') el
  where (el ->> 'id')::uuid = shift_a
    and (el -> 'handover' ->> 'resumen') = plain_resumen
    and (el -> 'handover' ->> 'comida') = plain_comida
    and (el -> 'handover' ->> 'animo') = plain_animo
    and (el -> 'handover' ->> 'pendientes') = plain_pendientes;
  if v_matched <> 1 then
    raise exception 'FALLO CIFRADO/ESTRUCTURA: handover de shift_a no vino descifrado o mal anidado';
  end if;

  -- NOTA: jsonb_build_object('handover', <subquery sin filas>) produce la clave presente
  -- con el LITERAL JSON null (`{"handover": null}`), no una clave ausente -- por eso se
  -- compara contra 'null'::jsonb (jsonb_typeof = 'null'), no con `is null` (que compararía
  -- contra SQL NULL, y ('...'::jsonb -> 'handover') nunca es SQL NULL si la clave existe).
  select count(*) into v_matched
  from jsonb_array_elements(v_export -> 'shifts') el
  where (el ->> 'id')::uuid = shift_a2
    and jsonb_typeof(el -> 'handover') = 'null';
  if v_matched <> 1 then
    raise exception 'FALLO: shift_a2 (sin traspaso) debería tener handover = null';
  end if;

  -- 9) Aislamiento: NINGÚN dato de la Familia B aparece en el export de la Familia A.
  if v_export::text like '%' || family_b::text || '%' then
    raise exception 'FALLO RLS: el export de Familia A contiene una referencia a family_b';
  end if;
  if v_export::text like '%' || cared_b::text || '%' then
    raise exception 'FALLO RLS: el export de Familia A contiene una referencia a cared_b';
  end if;

  -- 10) Aislamiento: user_a (Familia A) NO puede exportar la Familia B -- debe rechazar con
  --     insufficient_privilege, no devolver un jsonb vacío silenciosamente.
  begin
    select export_family_data(family_b) into v_export_b;
    raise exception 'FALLO RLS: user_a pudo exportar la Familia B (ajena) sin error';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  -- 11) p_family_id null: debe rechazar con invalid_parameter_value, no devolver null.
  begin
    perform export_family_data(null);
    raise exception 'FALLO: export_family_data(null) no lanzó excepción';
  exception
    when invalid_parameter_value then
      null; -- esperado.
  end;

  raise notice 'PGM-11 export_family_data smoke test: OK (aislamiento, árbol anidado completo y descifrado verificados)';

  -- 12) Limpieza del fixture (camino feliz).
  reset role;
  delete from shift_handovers where shift_id in (shift_a, shift_a2, shift_b);
  delete from shifts where family_id in (family_a, family_b);
  delete from medication_logs where medication_id = medication_a;
  delete from medications where cared_person_id in (cared_a, cared_b);
  delete from medical_contacts where cared_person_id in (cared_a, cared_b);
  delete from emergency_contacts where cared_person_id in (cared_a, cared_b);
  delete from cared_persons where id in (cared_a, cared_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_a2, user_b);

exception
  when others then
    reset role;
    delete from shift_handovers where shift_id in (shift_a, shift_a2, shift_b);
    delete from shifts where family_id in (family_a, family_b);
    delete from medication_logs where medication_id = medication_a;
    delete from medications where cared_person_id in (cared_a, cared_b);
    delete from medical_contacts where cared_person_id in (cared_a, cared_b);
    delete from emergency_contacts where cared_person_id in (cared_a, cared_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_a2, user_b);
    raise;
end $$;
