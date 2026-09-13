-- PGM-25: smoke test de aislamiento RLS para `shifts`, incluyendo el caso positivo de
-- reparto de turnos entre cuidadores de una misma familia (criterio de producto #4).
--
-- Verifica:
--   1) Aislamiento RLS estándar: un usuario de la Familia A no puede ver/modificar/borrar
--      los shifts de la Familia B (mismo patrón que supabase/tests/rls_isolation.test.sql
--      de PGM-15 y supabase/tests/cared_persons.test.sql de PGM-21).
--   2) CASO POSITIVO CRÍTICO (el que faltaba en el intento anterior y escondió el bug):
--      logueado como user_a (admin de la Familia A), un INSERT de un shift con
--      assigned_to = user_c (SEGUNDO miembro real de la Familia A, rol cuidador) debe
--      PASAR -- no debe lanzar insufficient_privilege. Esto prueba que is_family_member()
--      efectivamente resuelve la membresía de OTRO usuario bajo RLS, no solo la propia.
--   3) Caso negativo: assigned_to de un usuario que NO es miembro de la Familia A (es
--      miembro de la Familia B) debe seguir rechazado con insufficient_privilege.
--   4) cared_person_id sigue validando pertenencia a la misma familia: asignar un shift de
--      la Familia A a una cared_person de la Familia B debe rechazarse.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:shifts
--
-- Requisitos de la corrida (mismo patrón que los tests de PGM-15/PGM-21):
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
  user_a constant uuid := '71111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_b constant uuid := '72222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  user_c constant uuid := '73333333-3333-3333-3333-333333333333'; -- cuidador, familia A (2do miembro real)
  family_a constant uuid := 'a7111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a7222222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'a7311111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'a7322222-2222-2222-2222-222222222222';
  shift_a constant uuid := 'a7411111-1111-1111-1111-111111111111'; -- turno preexistente, familia A
  shift_b constant uuid := 'a7422222-2222-2222-2222-222222222222'; -- turno preexistente, familia B
  new_shift_id uuid;
  matched int;
  affected int;
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

  insert into cared_persons (id, family_id, full_name, created_by) values
    (cared_a, family_a, 'Persona cuidada A', user_a),
    (cared_b, family_b, 'Persona cuidada B', user_b);

  insert into shifts (id, family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by) values
    (shift_a, family_a, cared_a, user_a, now(), now() + interval '4 hours', user_a),
    (shift_b, family_b, cared_b, user_b, now(), now() + interval '4 hours', user_b);

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

  -- 3) Control positivo básico: user_a tiene que poder ver su propio shift.
  select count(*) into matched from shifts where id = shift_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propio shift (% filas)', matched;
  end if;

  -- 4) CASO POSITIVO CRÍTICO (el que faltaba y escondió el bug original): user_a asigna un
  --    turno nuevo a user_c, un SEGUNDO miembro real de la MISMA familia. Debe pasar.
  begin
    insert into shifts (family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by)
    values (family_a, cared_a, user_c, now() + interval '1 day', now() + interval '1 day 4 hours', user_a)
    returning id into new_shift_id;
  exception
    when insufficient_privilege then
      raise exception 'FALLO is_family_member(): user_a (admin de Familia A) NO pudo asignar un turno a user_c (2do miembro real de la MISMA familia) -- is_family_member() no está bypaseando la RLS de family_members como se esperaba';
  end;

  select count(*) into matched from shifts where id = new_shift_id and assigned_to = user_c;
  if matched <> 1 then
    raise exception 'FALLO: el turno asignado a user_c no quedó insertado correctamente (% filas)', matched;
  end if;

  -- 5) Caso negativo (el que ya se probaba antes, se mantiene): NO se puede asignar un
  --    turno de la Familia A a user_b, que es miembro de la Familia B, no de la A.
  begin
    insert into shifts (family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by)
    values (family_a, cared_a, user_b, now(), now() + interval '4 hours', user_a);
    raise exception 'FALLO RLS: user_a pudo asignar un shift de la Familia A a user_b, que NO es miembro de esa familia';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  -- 6) cared_person_id sigue validando pertenencia a la misma familia: no se puede asignar
  --    un turno de la Familia A a la cared_person de la Familia B.
  begin
    insert into shifts (family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by)
    values (family_a, cared_b, user_a, now(), now() + interval '4 hours', user_a);
    raise exception 'FALLO RLS: user_a pudo crear un shift de la Familia A apuntando a la cared_person de la Familia B';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  -- 7) Aislamiento estándar: user_a NO puede ver/actualizar/borrar el shift de la Familia B.
  select count(*) into matched from shifts where id = shift_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del shift de la Familia B (% filas)', matched;
  end if;

  update shifts set status = 'cancelled' where id = shift_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del shift de la Familia B (% filas)', affected;
  end if;

  delete from shifts where id = shift_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del shift de la Familia B (% filas)', affected;
  end if;

  -- 8) UPDATE legítimo dentro de la propia familia: user_a puede reasignar su propio turno
  --    a user_c (mismo chequeo que INSERT, pero vía UPDATE).
  update shifts set assigned_to = user_c where id = shift_a;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'FALLO: user_a no pudo reasignar shift_a a user_c dentro de la misma familia (% filas)', affected;
  end if;

  select count(*) into matched from shifts where id = shift_a and assigned_to = user_c;
  if matched <> 1 then
    raise exception 'FALLO: shift_a no quedó reasignado a user_c (% filas)', matched;
  end if;

  raise notice 'PGM-25 shifts smoke test: OK (aislamiento RLS + reparto entre cuidadores de la misma familia verificados)';

  -- 9) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from shifts where family_id in (family_a, family_b);
  delete from cared_persons where id in (cared_a, cared_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b, user_c);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from shifts where family_id in (family_a, family_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b, user_c);
    raise;
end $$;
