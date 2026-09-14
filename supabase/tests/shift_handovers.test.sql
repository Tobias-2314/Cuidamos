-- PGM-35: smoke test de aislamiento RLS y cifrado para shift_handovers.
--
-- Verifica los dos invariantes no negociables de esta issue:
--   1) Aislamiento RLS: un usuario de la Familia A no puede ver/modificar/borrar/insertar
--      traspasos de turno de la Familia B (mismo patrón que supabase/tests/shifts.test.sql
--      de PGM-25 y supabase/tests/cared_persons.test.sql de PGM-21, aplicado acá vía
--      shift_id -> shifts.family_id, dos niveles de indirección no recursiva).
--   2) Cifrado en reposo: los 4 campos de contenido (resumen, comida, animo, pendientes) se
--      guardan cifrados (bytea, nunca texto plano) y se recuperan correctamente vía
--      extensions.decrypt_text (mismo patrón que supabase/tests/encryption.test.sql de PGM-3
--      y supabase/tests/cared_persons.test.sql de PGM-21 para condition_notes) -- acá
--      aplicado a los 4 campos a la vez, porque en esta tabla el 100% del contenido va
--      cifrado (ver nota de diseño en la migración).
--
-- NOTA DE ALCANCE -- por qué el fixture inserta como `postgres` en vez de usar una RPC:
-- PGM-35 es solo modelo de datos (tabla + RLS + cifrado); las RPCs de lectura/escritura son
-- una issue de Backend futura (mismo bloqueante que medications -- ver comentario de la
-- migración 20260914160000_shift_handovers.sql). Sin una RPC que cifre server-side, un
-- INSERT directo bajo el rol `authenticated` no podría poblar resumen/comida/animo/
-- pendientes con texto plano cifrado correctamente. Por eso este test separa las dos
-- verificaciones:
--   * El fixture (incluye los INSERT con contenido cifrado real, vía
--     extensions.encrypt_text) se crea como `postgres` (bypassa RLS), igual que el fixture
--     de cualquier otro test de este proyecto.
--   * El aislamiento RLS bajo `authenticated` se prueba con SELECT/UPDATE/DELETE (que no
--     necesitan escribir contenido cifrado nuevo) y con un INSERT "intruso" que sí falla por
--     RLS antes de que el cifrado de sus columnas importe (el insert nunca llega a
--     insertarse, se bloquea por la policy).
-- Esto es exactamente lo que ya hace supabase/tests/cared_persons.test.sql para
-- condition_notes -- no hace falta un mecanismo nuevo.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README. Sin eso, este test falla con el mismo error que
--       fallaría la app real. ***
--   npm run test:shift-handovers
--
-- Requisitos de la corrida (mismo patrón que los demás tests de este proyecto):
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
  family_a constant uuid := 'a8111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a8222222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'a8311111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'a8322222-2222-2222-2222-222222222222';
  shift_a constant uuid := 'a8411111-1111-1111-1111-111111111111';
  shift_b constant uuid := 'a8422222-2222-2222-2222-222222222222';
  shift_extra constant uuid := 'a8433333-3333-3333-3333-333333333333'; -- 2do turno de la Familia A, sin traspaso todavía
  handover_a constant uuid := 'a8511111-1111-1111-1111-111111111111';
  handover_b constant uuid := 'a8522222-2222-2222-2222-222222222222';
  plain_resumen constant text := 'Turno tranquilo, sin incidentes';
  plain_comida constant text := 'Almorzó bien, cenó poco';
  plain_animo constant text := 'Contenta, charló bastante';
  plain_pendientes constant text := 'Renovar receta de ibuprofeno el lunes';
  new_handover_id uuid;
  matched int;
  affected int;
  raw_resumen bytea;
  raw_comida bytea;
  raw_animo bytea;
  raw_pendientes bytea;
  decrypted_resumen text;
  decrypted_comida text;
  decrypted_animo text;
  decrypted_pendientes text;
begin
  -- 1) Fixture: se crea como `postgres` (bypassa RLS) para no depender de las policies que
  --    estamos por probar. Los 4 campos de contenido se cifran con extensions.encrypt_text,
  --    igual que haría una futura RPC de escritura.
  insert into auth.users (id) values (user_a), (user_b);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_b, user_b, 'admin');

  insert into cared_persons (id, family_id, full_name, consent_given_at, created_by) values
    (cared_a, family_a, 'Persona cuidada A', now(), user_a),
    (cared_b, family_b, 'Persona cuidada B', now(), user_b);

  insert into shifts (id, family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by) values
    (shift_a, family_a, cared_a, user_a, now() - interval '8 hours', now(), user_a),
    (shift_b, family_b, cared_b, user_b, now() - interval '8 hours', now(), user_b),
    (shift_extra, family_a, cared_a, user_a, now(), now() + interval '8 hours', user_a);

  insert into shift_handovers (id, shift_id, resumen, comida, animo, pendientes, created_by) values
    (handover_a, shift_a, extensions.encrypt_text(plain_resumen), extensions.encrypt_text(plain_comida),
      extensions.encrypt_text(plain_animo), extensions.encrypt_text(plain_pendientes), user_a),
    (handover_b, shift_b, extensions.encrypt_text(plain_resumen), extensions.encrypt_text(plain_comida),
      extensions.encrypt_text(plain_animo), extensions.encrypt_text(plain_pendientes), user_b);

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

  -- 3) Control positivo: user_a tiene que poder ver el traspaso de su propio turno.
  select count(*) into matched from shift_handovers where id = handover_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver el traspaso de su propio turno (% filas)', matched;
  end if;

  -- 4) Cifrado: los 4 campos de contenido se descifran correctamente y ninguno contiene el
  --    texto plano en el valor crudo guardado en disco.
  select resumen, comida, animo, pendientes,
         extensions.decrypt_text(resumen), extensions.decrypt_text(comida),
         extensions.decrypt_text(animo), extensions.decrypt_text(pendientes)
    into raw_resumen, raw_comida, raw_animo, raw_pendientes,
         decrypted_resumen, decrypted_comida, decrypted_animo, decrypted_pendientes
    from shift_handovers
    where id = handover_a;

  if decrypted_resumen is distinct from plain_resumen then
    raise exception 'FALLO CIFRADO: decrypt_text(resumen) no devolvió el texto plano original (obtuvo: %)', decrypted_resumen;
  end if;
  if decrypted_comida is distinct from plain_comida then
    raise exception 'FALLO CIFRADO: decrypt_text(comida) no devolvió el texto plano original (obtuvo: %)', decrypted_comida;
  end if;
  if decrypted_animo is distinct from plain_animo then
    raise exception 'FALLO CIFRADO: decrypt_text(animo) no devolvió el texto plano original (obtuvo: %)', decrypted_animo;
  end if;
  if decrypted_pendientes is distinct from plain_pendientes then
    raise exception 'FALLO CIFRADO: decrypt_text(pendientes) no devolvió el texto plano original (obtuvo: %)', decrypted_pendientes;
  end if;

  if position(encode(convert_to(plain_resumen, 'utf8'), 'hex') in encode(raw_resumen, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: resumen contiene el texto plano sin cifrar en disco';
  end if;
  if position(encode(convert_to(plain_comida, 'utf8'), 'hex') in encode(raw_comida, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: comida contiene el texto plano sin cifrar en disco';
  end if;
  if position(encode(convert_to(plain_animo, 'utf8'), 'hex') in encode(raw_animo, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: animo contiene el texto plano sin cifrar en disco';
  end if;
  if position(encode(convert_to(plain_pendientes, 'utf8'), 'hex') in encode(raw_pendientes, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: pendientes contiene el texto plano sin cifrar en disco';
  end if;

  -- 5) Aislamiento: user_a NO puede ver/actualizar/borrar el traspaso de la Familia B.
  select count(*) into matched from shift_handovers where id = handover_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del traspaso de la Familia B (% filas)', matched;
  end if;

  update shift_handovers set resumen = extensions.encrypt_text('hackeado') where id = handover_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del traspaso de la Familia B (% filas)', affected;
  end if;

  delete from shift_handovers where id = handover_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del traspaso de la Familia B (% filas)', affected;
  end if;

  -- 6) Aislamiento: user_a NO puede insertar un traspaso colgado del turno de la Familia B
  --    (el `with check` de INSERT debe bloquearlo con insufficient_privilege).
  begin
    insert into shift_handovers (shift_id, resumen, created_by)
    values (shift_b, extensions.encrypt_text('traspaso intruso'), user_a);
    raise exception 'FALLO RLS: user_a pudo insertar un shift_handover sobre el turno de la Familia B';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  -- 7) Caso positivo: user_a SÍ puede insertar un traspaso nuevo para OTRO turno de su
  --    propia familia (shift_extra, que todavía no tenía traspaso).
  begin
    insert into shift_handovers (shift_id, resumen, comida, animo, pendientes, created_by)
    values (shift_extra, extensions.encrypt_text(plain_resumen), null, null, null, user_a)
    returning id into new_handover_id;
  exception
    when insufficient_privilege then
      raise exception 'FALLO RLS: user_a no pudo insertar un traspaso para un turno de SU PROPIA familia';
  end;

  select count(*) into matched from shift_handovers where id = new_handover_id and shift_id = shift_extra;
  if matched <> 1 then
    raise exception 'FALLO: el traspaso nuevo para shift_extra no quedó insertado correctamente (% filas)', matched;
  end if;

  -- 8) UPDATE legítimo dentro de la propia familia: user_a puede corregir su propio traspaso
  --    (relación 1:1 con el turno -- corregir es UPDATE, no un INSERT nuevo).
  update shift_handovers set comida = extensions.encrypt_text('corrección: cenó todo') where id = handover_a;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'FALLO: user_a no pudo actualizar su propio traspaso (% filas)', affected;
  end if;

  select extensions.decrypt_text(comida) into decrypted_comida from shift_handovers where id = handover_a;
  if decrypted_comida is distinct from 'corrección: cenó todo' then
    raise exception 'FALLO: el UPDATE de comida no se reflejó correctamente (obtuvo: %)', decrypted_comida;
  end if;

  -- 9) shift_id UNIQUE: no se puede insertar un segundo traspaso para un turno que ya tiene
  --    uno (shift_a, que ya tiene handover_a).
  begin
    insert into shift_handovers (shift_id, resumen, created_by)
    values (shift_a, extensions.encrypt_text('traspaso duplicado'), user_a);
    raise exception 'FALLO CONSTRAINT: se pudo insertar un segundo traspaso para un turno que ya tenía uno';
  exception
    when unique_violation then
      null; -- esperado: shift_id UNIQUE bloqueó el insert.
  end;

  raise notice 'PGM-35 shift_handovers smoke test: OK (aislamiento RLS, cifrado de los 4 campos y UNIQUE shift_id verificados)';

  -- 10) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from shift_handovers where shift_id in (shift_a, shift_b, shift_extra);
  delete from shifts where family_id in (family_a, family_b);
  delete from cared_persons where id in (cared_a, cared_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from shift_handovers where shift_id in (shift_a, shift_b, shift_extra);
    delete from shifts where family_id in (family_a, family_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
