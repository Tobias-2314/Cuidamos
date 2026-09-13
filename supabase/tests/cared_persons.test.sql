-- PGM-21: smoke test de aislamiento RLS y cifrado para cared_persons/medical_contacts/
-- emergency_contacts.
--
-- Verifica los dos invariantes no negociables de esta issue:
--   1) Aislamiento RLS: un usuario de la Familia A no puede ver/modificar las
--      cared_persons/medical_contacts/emergency_contacts de la Familia B (mismo patrón que
--      supabase/tests/rls_isolation.test.sql de PGM-15, aplicado un nivel más adentro).
--   2) Cifrado en reposo: cared_persons.condition_notes se guarda cifrado (bytea, nunca
--      texto plano) y se recupera correctamente vía extensions.decrypt_text (mismo patrón
--      que supabase/tests/encryption.test.sql de PGM-3).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README. Sin eso, este test falla con el mismo error que
--       fallaría la app real. ***
--   npm run test:cared-persons
--
-- Requisitos de la corrida (mismo patrón que los tests de PGM-15/PGM-3):
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
  user_a constant uuid := '44444444-4444-4444-4444-444444444444';
  user_b constant uuid := '55555555-5555-5555-5555-555555555555';
  family_a constant uuid := 'c1111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'd2222222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'e1111111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'e2222222-2222-2222-2222-222222222222';
  med_contact_a constant uuid := 'f1111111-1111-1111-1111-111111111111';
  med_contact_b constant uuid := 'f2222222-2222-2222-2222-222222222222';
  em_contact_a constant uuid := '61111111-1111-1111-1111-111111111111';
  em_contact_b constant uuid := '62222222-2222-2222-2222-222222222222';
  plain constant text := 'hipertensión controlada, requiere medicación diaria a las 8am';
  matched int;
  affected int;
  decrypted text;
  raw_cipher bytea;
begin
  -- 1) Fixture: se crea como `postgres` (bypassa RLS) para no depender de las policies que
  --    estamos por probar.
  insert into auth.users (id) values (user_a), (user_b);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_b, user_b, 'admin');

  insert into cared_persons (id, family_id, full_name, condition_notes, created_by) values
    (cared_a, family_a, 'Persona cuidada A', extensions.encrypt_text(plain), user_a),
    (cared_b, family_b, 'Persona cuidada B', extensions.encrypt_text(plain), user_b);

  insert into medical_contacts (id, cared_person_id, full_name, specialty, phone, created_by) values
    (med_contact_a, cared_a, 'Dr. A', 'Clínica médica', '111-1111', user_a),
    (med_contact_b, cared_b, 'Dr. B', 'Clínica médica', '222-2222', user_b);

  insert into emergency_contacts (id, cared_person_id, full_name, relationship, phone, created_by) values
    (em_contact_a, cared_a, 'Contacto A', 'hijo/a', '111-9999', user_a),
    (em_contact_b, cared_b, 'Contacto B', 'hijo/a', '222-9999', user_b);

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

  -- 3) Control positivo: user_a tiene que poder ver su propia cared_person y sus contactos.
  select count(*) into matched from cared_persons where id = cared_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propia cared_person (% filas)', matched;
  end if;

  select count(*) into matched from medical_contacts where id = med_contact_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propio medical_contact (% filas)', matched;
  end if;

  select count(*) into matched from emergency_contacts where id = em_contact_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propio emergency_contact (% filas)', matched;
  end if;

  -- 4) Cifrado: condition_notes de la propia cared_person se descifra correctamente y el
  --    valor crudo en disco no contiene el texto plano.
  select condition_notes, extensions.decrypt_text(condition_notes)
    into raw_cipher, decrypted
    from cared_persons
    where id = cared_a;

  if decrypted is distinct from plain then
    raise exception 'FALLO CIFRADO: decrypt_text(condition_notes) no devolvió el texto plano original (obtuvo: %)', decrypted;
  end if;

  if position(encode(convert_to(plain, 'utf8'), 'hex') in encode(raw_cipher, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: condition_notes contiene el texto plano sin cifrar en disco';
  end if;

  -- 5) Aislamiento: user_a NO puede ver la cared_person/contactos de la Familia B.
  select count(*) into matched from cared_persons where id = cared_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT de la cared_person de la Familia B (% filas)', matched;
  end if;

  select count(*) into matched from medical_contacts where id = med_contact_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del medical_contact de la Familia B (% filas)', matched;
  end if;

  select count(*) into matched from emergency_contacts where id = em_contact_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del emergency_contact de la Familia B (% filas)', matched;
  end if;

  -- 6) Aislamiento: user_a NO puede actualizar la cared_person/contactos de la Familia B
  --    (debe afectar 0 filas, no explotar).
  update cared_persons set full_name = 'hackeado' where id = cared_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE de la cared_person de la Familia B (% filas)', affected;
  end if;

  update medical_contacts set full_name = 'hackeado' where id = med_contact_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del medical_contact de la Familia B (% filas)', affected;
  end if;

  update emergency_contacts set full_name = 'hackeado' where id = em_contact_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del emergency_contact de la Familia B (% filas)', affected;
  end if;

  -- 7) Aislamiento: user_a NO puede borrar la cared_person/contactos de la Familia B.
  delete from emergency_contacts where id = em_contact_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del emergency_contact de la Familia B (% filas)', affected;
  end if;

  delete from medical_contacts where id = med_contact_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del medical_contact de la Familia B (% filas)', affected;
  end if;

  delete from cared_persons where id = cared_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE de la cared_person de la Familia B (% filas)', affected;
  end if;

  -- 8) Aislamiento: user_a NO puede insertar un contacto colgado de la cared_person de la
  --    Familia B (el `with check` de INSERT debe bloquearlo con insufficient_privilege, no
  --    dejarlo pasar silenciosamente).
  begin
    insert into medical_contacts (cared_person_id, full_name, created_by)
    values (cared_b, 'contacto intruso', user_a);
    raise exception 'FALLO RLS: user_a pudo insertar un medical_contact sobre la cared_person de la Familia B';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  begin
    insert into emergency_contacts (cared_person_id, full_name, phone, created_by)
    values (cared_b, 'contacto intruso', '000-0000', user_a);
    raise exception 'FALLO RLS: user_a pudo insertar un emergency_contact sobre la cared_person de la Familia B';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  raise notice 'PGM-21 cared_persons smoke test: OK (aislamiento RLS y cifrado de condition_notes verificados)';

  -- 9) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from emergency_contacts where cared_person_id in (cared_a, cared_b);
  delete from medical_contacts where cared_person_id in (cared_a, cared_b);
  delete from cared_persons where id in (cared_a, cared_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from emergency_contacts where cared_person_id in (cared_a, cared_b);
    delete from medical_contacts where cared_person_id in (cared_a, cared_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
