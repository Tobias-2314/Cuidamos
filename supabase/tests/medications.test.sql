-- PGM-30: smoke test de aislamiento RLS, cifrado y reparto de registro de tomas para
-- `medications`/`medication_logs`.
--
-- Verifica:
--   1) Aislamiento RLS: un usuario de la Familia A no puede ver/modificar/borrar los
--      medications/medication_logs de la Familia B (mismo patrón que
--      supabase/tests/cared_persons.test.sql de PGM-21 y supabase/tests/shifts.test.sql de
--      PGM-25, aplicado con un nivel extra de indirección para medication_logs).
--   2) Cifrado en reposo: medications.name/dose y medication_logs.note se guardan
--      cifrados (bytea, nunca texto plano) y se recuperan correctamente vía
--      extensions.decrypt_text (mismo patrón que supabase/tests/encryption.test.sql de
--      PGM-3 y supabase/tests/cared_persons.test.sql de PGM-21).
--   3) CASO POSITIVO CRÍTICO (aprendizaje de PGM-25 -- no asumir que is_family_member()
--      funciona sin probarlo con un segundo usuario real): logueado como el admin de la
--      Familia A, un INSERT de un medication_log con taken_by = OTRO miembro real de la
--      MISMA familia (no el propio admin) debe PASAR.
--   4) Caso negativo: taken_by de un usuario que NO es miembro de la Familia A (es
--      miembro de la Familia B) debe seguir rechazado con insufficient_privilege.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README. Sin eso, este test falla con el mismo error que
--       fallaría la app real. ***
--   npm run test:medications
--
-- Requisitos de la corrida (mismo patrón que los tests de PGM-15/PGM-21/PGM-25):
--   * Corre contra el Postgres local de Supabase (`supabase db query --local`), nunca
--     contra staging/prod.
--   * `supabase db query -f` solo acepta UN statement top-level, así que todo el test vive
--     en un único bloque `do $$ ... $$`, con limpieza explícita del fixture al final --
--     tanto en el camino feliz como en el bloque `exception`.
--   * Si una aserción falla, el bloque hace `raise exception`, lo que hace que
--     `supabase db query` termine con exit code != 0 (falla visible en terminal/CI).
--   * Los fixtures usan UUIDs fijos que no deberían colisionar con datos reales de
--     desarrollo; igual se borran siempre al final.

do $$
declare
  user_a constant uuid := '81111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_b constant uuid := '82222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  user_c constant uuid := '83333333-3333-3333-3333-333333333333'; -- cuidador, familia A (2do miembro real)
  family_a constant uuid := 'a8111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a8222222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'a8311111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'a8322222-2222-2222-2222-222222222222';
  med_a constant uuid := 'a8411111-1111-1111-1111-111111111111'; -- medicamento preexistente, familia A
  med_b constant uuid := 'a8422222-2222-2222-2222-222222222222'; -- medicamento preexistente, familia B
  log_a constant uuid := 'a8511111-1111-1111-1111-111111111111'; -- log preexistente, familia A
  log_b constant uuid := 'a8522222-2222-2222-2222-222222222222'; -- log preexistente, familia B
  plain_name constant text := 'Enalapril';
  plain_dose constant text := '10mg';
  plain_note constant text := 'tomado con el desayuno, sin efectos adversos';
  new_log_id uuid;
  matched int;
  affected int;
  decrypted_name text;
  decrypted_dose text;
  decrypted_note text;
  raw_name_cipher bytea;
begin
  -- 1) Fixture: se crea como `postgres` (bypassa RLS) para no depender de las policies que
  --    estamos por probar.
  insert into auth.users (id) values (user_a), (user_b), (user_c);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_c, 'cuidador'), -- 2do miembro real de la Familia A
    (family_b, user_b, 'admin');

  -- consent_given_at explícito: NOT NULL desde PGM-24.
  insert into cared_persons (id, family_id, full_name, consent_given_at, created_by) values
    (cared_a, family_a, 'Persona cuidada A', now(), user_a),
    (cared_b, family_b, 'Persona cuidada B', now(), user_b);

  insert into medications (id, cared_person_id, name, dose, schedule, created_by) values
    (med_a, cared_a, extensions.encrypt_text(plain_name), extensions.encrypt_text(plain_dose), 'cada 8 horas', user_a),
    (med_b, cared_b, extensions.encrypt_text(plain_name), extensions.encrypt_text(plain_dose), 'cada 8 horas', user_b);

  insert into medication_logs (id, medication_id, taken_by, taken_at, note) values
    (log_a, med_a, user_a, now(), extensions.encrypt_text(plain_note)),
    (log_b, med_b, user_b, now(), extensions.encrypt_text(plain_note));

  -- 2) A partir de acá actuamos como el rol `authenticated` (el que usa PostgREST/la app),
  --    logueados como user_a (Familia A).
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- 3) Control positivo: user_a tiene que poder ver su propio medicamento y su propio log.
  select count(*) into matched from medications where id = med_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propio medication (% filas)', matched;
  end if;

  select count(*) into matched from medication_logs where id = log_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propio medication_log (% filas)', matched;
  end if;

  -- 4) Cifrado: name/dose de medications y note de medication_logs se descifran
  --    correctamente y el valor crudo en disco no contiene el texto plano.
  select name into raw_name_cipher from medications where id = med_a;
  select extensions.decrypt_text(name) into decrypted_name from medications where id = med_a;
  select extensions.decrypt_text(dose) into decrypted_dose from medications where id = med_a;

  if decrypted_name is distinct from plain_name then
    raise exception 'FALLO CIFRADO: decrypt_text(medications.name) no devolvió el texto plano original (obtuvo: %)', decrypted_name;
  end if;

  if decrypted_dose is distinct from plain_dose then
    raise exception 'FALLO CIFRADO: decrypt_text(medications.dose) no devolvió el texto plano original (obtuvo: %)', decrypted_dose;
  end if;

  if position(encode(convert_to(plain_name, 'utf8'), 'hex') in encode(raw_name_cipher, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: medications.name contiene el texto plano sin cifrar en disco';
  end if;

  select extensions.decrypt_text(note) into decrypted_note from medication_logs where id = log_a;
  if decrypted_note is distinct from plain_note then
    raise exception 'FALLO CIFRADO: decrypt_text(medication_logs.note) no devolvió el texto plano original (obtuvo: %)', decrypted_note;
  end if;

  -- 5) CASO POSITIVO CRÍTICO (aprendizaje de PGM-25 -- probar explícitamente, no asumir):
  --    user_a (admin de Familia A) registra un log de toma con taken_by = user_c, un
  --    SEGUNDO miembro real de la MISMA familia. Debe pasar.
  begin
    insert into medication_logs (medication_id, taken_by, taken_at, note)
    values (med_a, user_c, now(), extensions.encrypt_text('dado por user_c'))
    returning id into new_log_id;
  exception
    when insufficient_privilege then
      raise exception 'FALLO is_family_member(): user_a (admin de Familia A) NO pudo registrar un medication_log con taken_by = user_c (2do miembro real de la MISMA familia) -- is_family_member() no está bypaseando la RLS de family_members como se esperaba';
  end;

  select count(*) into matched from medication_logs where id = new_log_id and taken_by = user_c;
  if matched <> 1 then
    raise exception 'FALLO: el medication_log con taken_by = user_c no quedó insertado correctamente (% filas)', matched;
  end if;

  -- 6) Caso negativo: NO se puede registrar un log de un medicamento de la Familia A con
  --    taken_by = user_b, que es miembro de la Familia B, no de la A.
  begin
    insert into medication_logs (medication_id, taken_by, taken_at)
    values (med_a, user_b, now());
    raise exception 'FALLO RLS: user_a pudo registrar un medication_log de la Familia A con taken_by = user_b, que NO es miembro de esa familia';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  -- 7) Aislamiento: user_a NO puede ver el medicamento/log de la Familia B.
  select count(*) into matched from medications where id = med_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del medication de la Familia B (% filas)', matched;
  end if;

  select count(*) into matched from medication_logs where id = log_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del medication_log de la Familia B (% filas)', matched;
  end if;

  -- 8) Aislamiento: user_a NO puede actualizar el medicamento/log de la Familia B (debe
  --    afectar 0 filas, no explotar).
  update medications set schedule = 'hackeado' where id = med_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del medication de la Familia B (% filas)', affected;
  end if;

  update medication_logs set taken_at = now() where id = log_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del medication_log de la Familia B (% filas)', affected;
  end if;

  -- 9) Aislamiento: user_a NO puede borrar el medicamento/log de la Familia B.
  delete from medication_logs where id = log_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del medication_log de la Familia B (% filas)', affected;
  end if;

  delete from medications where id = med_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del medication de la Familia B (% filas)', affected;
  end if;

  -- 10) Aislamiento: user_a NO puede insertar un medication colgado de la cared_person de
  --     la Familia B.
  begin
    insert into medications (cared_person_id, name, dose, created_by)
    values (cared_b, extensions.encrypt_text('intruso'), extensions.encrypt_text('0mg'), user_a);
    raise exception 'FALLO RLS: user_a pudo insertar un medication sobre la cared_person de la Familia B';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  -- 11) PGM-32: RPCs get_medications_for_family/create_medication_log (ver
  --     20260913241500_medications_rpc.sql) -- devuelven texto plano ya descifrado y
  --     siguen sujetas a las mismas policies de RLS que el resto de este test.
  select count(*) into matched
  from public.get_medications_for_family(family_a)
  where id = med_a and name = plain_name and dose = plain_dose;
  if matched <> 1 then
    raise exception 'FALLO RPC: get_medications_for_family(family_a) no devolvió med_a con name/dose descifrados (% filas)', matched;
  end if;

  select count(*) into matched from public.get_medications_for_family(family_b);
  if matched <> 0 then
    raise exception 'FALLO RLS vía RPC: get_medications_for_family(family_b) devolvió filas de otra familia a user_a (% filas)', matched;
  end if;

  select id, note into new_log_id, decrypted_note
  from public.create_medication_log(med_a, now(), 'tomado por RPC, sin efectos');
  if new_log_id is null or decrypted_note is distinct from 'tomado por RPC, sin efectos' then
    raise exception 'FALLO RPC: create_medication_log no devolvió un log con note en texto plano (id: %, note: %)', new_log_id, decrypted_note;
  end if;

  perform 1 from medication_logs where id = new_log_id and taken_by = user_a;
  if not found then
    raise exception 'FALLO RPC: create_medication_log no fijó taken_by = auth.uid() (user_a)';
  end if;

  begin
    perform public.create_medication_log(med_b, now(), 'intento sobre medicamento ajeno');
    raise exception 'FALLO RLS vía RPC: create_medication_log pudo insertar un log sobre un medicamento de la Familia B';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS (security invoker) bloqueó el insert igual que un insert directo.
  end;

  raise notice 'PGM-30 medications/medication_logs smoke test: OK (aislamiento RLS, cifrado y reparto de registro de tomas verificados)';

  -- 12) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from medication_logs where medication_id in (med_a, med_b);
  delete from medications where id in (med_a, med_b);
  delete from cared_persons where id in (cared_a, cared_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b, user_c);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from medication_logs where medication_id in (med_a, med_b);
    delete from medications where id in (med_a, med_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b, user_c);
    raise;
end $$;
