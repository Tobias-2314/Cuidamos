-- PGM-backend: smoke test de create_shift_handover() y
-- get_latest_shift_handover_for_family() -- cierra el TODO de PGM-36/PGM-37.
--
-- Verifica los invariantes no negociables de esta issue:
--   1) create_shift_handover(): cifra los 4 campos server-side (la fila cruda en la
--      tabla es bytea, nunca texto plano) y devuelve los valores en texto plano tal
--      como se recibieron.
--   2) create_shift_handover() respeta shift_handovers_insert_member -- un shift_id de
--      una familia ajena se rechaza con insufficient_privilege.
--   3) Una segunda llamada para el mismo shift_id falla con unique_violation (relacion
--      1:1, no hace upsert).
--   4) get_latest_shift_handover_for_family() devuelve el traspaso mas reciente entre
--      varios turnos de la familia, ya descifrado, con el rango horario del turno.
--   5) get_latest_shift_handover_for_family() devuelve 0 filas para una familia sin
--      ningun traspaso, y 0 filas (nunca datos ajenos) para una familia ajena.
--
-- Como correrlo:
--   npm run db:start   (una vez, si el stack local no esta arriba)
--   *** Requiere app.settings.encryption_key seteada en esta sesion de Postgres -- ver
--       seccion 2 de supabase/migrations/20260913210000_encryption_helpers.sql. ***
--   npm run test:shift-handovers-rpc

do $$
declare
  user_a constant uuid := '97111111-1111-1111-1111-111111111111';
  user_b constant uuid := '97222222-2222-2222-2222-222222222222';
  family_a constant uuid := 'a9711111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a9722222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'a9731111-1111-1111-1111-111111111111';
  cared_b constant uuid := 'a9732222-2222-2222-2222-222222222222';
  shift_a1 constant uuid := 'a9741111-1111-1111-1111-111111111111'; -- turno viejo, con traspaso
  shift_a2 constant uuid := 'a9742222-2222-2222-2222-222222222222'; -- turno mas nuevo, con traspaso -- debe ganar
  shift_b constant uuid := 'a9743333-3333-3333-3333-333333333333'; -- familia ajena

  v_row record;
  v_matched int;
  raw_resumen bytea;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS).
  insert into auth.users (id) values (user_a), (user_b);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_b, user_b, 'admin');

  insert into cared_persons (id, family_id, full_name, consent_given_at, created_by) values
    (cared_a, family_a, 'Persona A', now(), user_a),
    (cared_b, family_b, 'Persona B', now(), user_b);

  insert into shifts (id, family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by) values
    (shift_a1, family_a, cared_a, user_a, now() - interval '2 days', now() - interval '2 days' + interval '8 hours', user_a),
    (shift_a2, family_a, cared_a, user_a, now() - interval '1 hour', now() + interval '7 hours', user_a),
    (shift_b, family_b, cared_b, user_b, now() - interval '1 hour', now() + interval '7 hours', user_b);

  -- 2) A partir de aca actuamos como `authenticated`, logueados como user_a.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup invalido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- 3) create_shift_handover(): camino feliz sobre shift_a1 (el mas viejo).
  select id, shift_id, resumen, comida, animo, pendientes, created_by
    into v_row
    from create_shift_handover(shift_a1, 'Turno tranquilo', 'Comio bien', null, 'Renovar receta');

  if v_row.resumen is distinct from 'Turno tranquilo' then
    raise exception 'FALLO: create_shift_handover no devolvio resumen esperado (obtuvo %)', v_row.resumen;
  end if;
  if v_row.animo is not null then
    raise exception 'FALLO: create_shift_handover deberia devolver animo null (obtuvo %)', v_row.animo;
  end if;
  if v_row.created_by is distinct from user_a then
    raise exception 'FALLO: created_by deberia ser auth.uid() (obtuvo %)', v_row.created_by;
  end if;

  -- 4) La fila cruda en la tabla esta cifrada -- nunca texto plano. Comparamos en
  --    bytea (convirtiendo el plaintext CONOCIDO a bytea), nunca al reves -- decodificar
  --    bytes cifrados (esencialmente aleatorios) como UTF8 rompe con "invalid byte
  --    sequence", no prueba nada sobre si esta cifrado o no.
  reset role;
  select resumen into raw_resumen from shift_handovers where shift_id = shift_a1;
  if raw_resumen = convert_to('Turno tranquilo', 'UTF8') then
    raise exception 'FALLO CIFRADO: shift_handovers.resumen quedo en texto plano';
  end if;
  set local role authenticated;

  -- 5) Segunda llamada para el MISMO shift_id falla con unique_violation.
  begin
    perform create_shift_handover(shift_a1, 'Otro resumen');
    raise exception 'FALLO: create_shift_handover permitio un segundo traspaso para el mismo turno';
  exception
    when unique_violation then
      null; -- esperado.
  end;

  -- 6) create_shift_handover() sobre un shift_id de una familia ajena -> insufficient_privilege.
  begin
    perform create_shift_handover(shift_b, 'Intruso');
    raise exception 'FALLO RLS: user_a pudo crear un traspaso sobre un turno de family_b';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  -- 7) create_shift_handover() sobre shift_a2 (mas nuevo) -- para probar el "mas reciente".
  perform create_shift_handover(shift_a2, 'Turno con incidente', null, 'Cansada', null);

  -- now() queda congelado al inicio de la transaccion en PL/pgSQL -- ambos handovers
  -- insertados arriba comparten el mismo created_at por default. Para poder probar de
  -- verdad el ORDER BY created_at desc de get_latest_shift_handover_for_family, forzamos
  -- que el de shift_a2 quede con un created_at explicitamente mas nuevo (como `postgres`,
  -- bypassa RLS -- esto es setup de fixture, no parte del comportamiento bajo prueba).
  reset role;
  update shift_handovers set created_at = now() + interval '1 minute' where shift_id = shift_a2;
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  -- 8) get_latest_shift_handover_for_family(): debe traer el de shift_a2 (mas reciente),
  --    no el de shift_a1, con el rango horario del turno correcto.
  select shift_id, resumen, animo, shift_starts_at
    into v_row
    from get_latest_shift_handover_for_family(family_a);

  if v_row.shift_id is distinct from shift_a2 then
    raise exception 'FALLO: get_latest_shift_handover_for_family no devolvio el mas reciente (obtuvo shift_id %)', v_row.shift_id;
  end if;
  if v_row.resumen is distinct from 'Turno con incidente' then
    raise exception 'FALLO: resumen del traspaso mas reciente no coincide (obtuvo %)', v_row.resumen;
  end if;
  if v_row.animo is distinct from 'Cansada' then
    raise exception 'FALLO: animo del traspaso mas reciente no coincide (obtuvo %)', v_row.animo;
  end if;

  -- 9) Aislamiento: family_a no ve nada de family_b.
  select count(*) into v_matched
  from get_latest_shift_handover_for_family(family_a) r
  where r.shift_id = shift_b;
  if v_matched <> 0 then
    raise exception 'FALLO AISLAMIENTO: get_latest_shift_handover_for_family(family_a) devolvio datos de family_b';
  end if;

  -- 10) Familia sin ningun traspaso -> 0 filas, no error.
  select count(*) into v_matched from get_latest_shift_handover_for_family(family_b);
  if v_matched <> 0 then
    raise exception 'FALLO: get_latest_shift_handover_for_family(family_b) deberia devolver 0 filas (sin traspasos), obtuvo %', v_matched;
  end if;

  raise notice 'PGM-backend shift_handovers_rpc smoke test: OK (cifrado, unicidad, aislamiento y "mas reciente" verificados)';

  -- 11) Limpieza del fixture (camino feliz).
  reset role;
  delete from shift_handovers where shift_id in (shift_a1, shift_a2, shift_b);
  delete from shifts where id in (shift_a1, shift_a2, shift_b);
  delete from cared_persons where id in (cared_a, cared_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    reset role;
    delete from shift_handovers where shift_id in (shift_a1, shift_a2, shift_b);
    delete from shifts where id in (shift_a1, shift_a2, shift_b);
    delete from cared_persons where id in (cared_a, cared_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
