-- PGM-22: smoke test para la RPC de escritura `create_cared_person`
-- (20260914130000_cared_persons_write_rpc.sql).
--
-- Verifica:
--   1) Caso positivo: logueado como admin de la Familia A, create_cared_person crea el
--      perfil, fija consent_given_at = now() internamente (nunca lo recibe como parámetro),
--      cifra condition_notes server-side (bytea en disco, decrypt_text lo recupera en texto
--      plano) y devuelve la fila con condition_notes ya en texto plano.
--   2) full_name vacío (string vacío o solo espacios) es rechazado ANTES de crear la fila.
--   3) Aislamiento RLS: un usuario que NO es miembro de la Familia A no puede crear una
--      cared_person para esa familia vía la RPC (insufficient_privilege, mismo criterio que
--      medications_insert_member en supabase/tests/medications.test.sql).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README. Sin eso, este test falla con el mismo error que
--       fallaría la app real. ***
--   npm run test:cared-persons-write-rpc
--
-- Requisitos de la corrida (mismo patrón que supabase/tests/medications.test.sql):
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
  user_a constant uuid := '85111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_b constant uuid := '85222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  family_a constant uuid := 'a9111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a9222222-2222-2222-2222-222222222222';
  plain_notes constant text := 'hipertensión, controlar presión dos veces por día';
  new_cared_id uuid;
  returned_full_name text;
  returned_birth_date date;
  returned_condition_notes text;
  returned_consent_given_at timestamptz;
  returned_created_by uuid;
  raw_notes_cipher bytea;
  decrypted_notes text;
  matched int;
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

  -- 3) Caso positivo: user_a crea el perfil de su propia familia, con condition_notes.
  select id, full_name, birth_date, condition_notes, consent_given_at, created_by
  into new_cared_id, returned_full_name, returned_birth_date, returned_condition_notes,
    returned_consent_given_at, returned_created_by
  from public.create_cared_person(
    p_family_id => family_a,
    p_full_name => 'Persona cuidada A',
    p_birth_date => date '1945-03-20',
    p_condition_notes => plain_notes
  );

  if new_cared_id is null
    or returned_full_name is distinct from 'Persona cuidada A'
    or returned_birth_date is distinct from date '1945-03-20'
    or returned_condition_notes is distinct from plain_notes
  then
    raise exception 'FALLO RPC: create_cared_person no devolvió la fila en texto plano tal como se envió (id: %, full_name: %, birth_date: %, condition_notes: %)',
      new_cared_id, returned_full_name, returned_birth_date, returned_condition_notes;
  end if;

  if returned_created_by is distinct from user_a then
    raise exception 'FALLO RPC: create_cared_person no fijó created_by = auth.uid() (obtuvo: %)', returned_created_by;
  end if;

  -- 4) Consentimiento (RGPD, PGM-24): consent_given_at tiene que haber sido fijado
  --    internamente por la RPC -- nunca nulo, nunca en el futuro, nunca un valor viejo. No
  --    hay ningún parámetro `p_consent_given_at` en la firma de la función (ver migración):
  --    esa es la garantía real de que el cliente no puede mandar un valor retroactivo o
  --    arbitrario. Acá solo chequeamos, como sanity check adicional, que el valor sea
  --    reciente -- se compara contra clock_timestamp() (hora real de pared) y no contra
  --    now() (que dentro de esta misma transacción queda fijo al inicio de este bloque,
  --      antes del fixture, así que no sirve como referencia de "recién ahora").
  if returned_consent_given_at is null
    or returned_consent_given_at > clock_timestamp()
    or clock_timestamp() - returned_consent_given_at > interval '5 minutes'
  then
    raise exception 'FALLO CONSENTIMIENTO: consent_given_at (%) no es un timestamp reciente y válido (clock_timestamp() actual: %) -- no se está fijando con now() internamente en el momento del INSERT',
      returned_consent_given_at, clock_timestamp();
  end if;

  -- 5) Cifrado: condition_notes se guarda cifrado (bytea) y decrypt_text lo recupera igual
  --    al texto plano original -- nunca en texto plano en disco.
  select condition_notes into raw_notes_cipher from cared_persons where id = new_cared_id;
  select extensions.decrypt_text(condition_notes) into decrypted_notes from cared_persons where id = new_cared_id;

  if decrypted_notes is distinct from plain_notes then
    raise exception 'FALLO CIFRADO: decrypt_text(cared_persons.condition_notes) no devolvió el texto plano original (obtuvo: %)', decrypted_notes;
  end if;

  if position(encode(convert_to(plain_notes, 'utf8'), 'hex') in encode(raw_notes_cipher, 'hex')) > 0 then
    raise exception 'FALLO CIFRADO: cared_persons.condition_notes contiene el texto plano sin cifrar en disco';
  end if;

  -- 6) full_name vacío (string vacío o solo espacios) debe ser rechazado ANTES de crear la
  --    fila -- no debe quedar ninguna fila nueva por este intento.
  begin
    perform public.create_cared_person(p_family_id => family_a, p_full_name => '   ');
    raise exception 'FALLO VALIDACIÓN: create_cared_person aceptó un full_name vacío/solo espacios';
  exception
    when others then
      if sqlstate <> '22023' then
        raise exception 'FALLO VALIDACIÓN: create_cared_person con full_name vacío falló con sqlstate % (esperado 22023)', sqlstate;
      end if;
  end;

  -- 7) Aislamiento RLS: user_a (Familia A) NO puede crear una cared_person para la Familia B
  --    (de la que no es miembro) vía la RPC.
  begin
    perform public.create_cared_person(p_family_id => family_b, p_full_name => 'intruso');
    raise exception 'FALLO RLS vía RPC: create_cared_person pudo insertar un perfil sobre la Familia B, de la que user_a no es miembro';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS (security invoker) bloqueó el insert igual que un insert directo.
  end;

  select count(*) into matched from cared_persons where family_id = family_b;
  if matched <> 0 then
    raise exception 'FALLO RLS vía RPC: quedó una cared_person creada indebidamente en la Familia B (% filas)', matched;
  end if;

  raise notice 'PGM-22 create_cared_person smoke test: OK (consentimiento, cifrado, validación de full_name y aislamiento RLS verificados)';

  -- 8) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from cared_persons where id = new_cared_id or family_id in (family_a, family_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from cared_persons where id = new_cared_id or family_id in (family_a, family_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
