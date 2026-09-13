-- PGM-15: smoke test de aislamiento RLS entre familias.
--
-- Verifica el invariante de seguridad no negociable de esta issue: un usuario que NO
-- pertenece a una familia no puede leer, actualizar, borrar, ni unirse a las filas de
-- `families`/`family_members` de esa familia.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:rls
--
-- Requisitos de la corrida:
--   * Corre contra el Postgres local de Supabase (`supabase db query --local`), nunca
--     contra staging/prod.
--   * `supabase db query -f` solo acepta UN statement top-level (el driver rechaza
--     mandar varios comandos separados por ";" a un prepared statement), así que no
--     se puede envolver este archivo en `begin; ... rollback;` como statements sueltos.
--     En su lugar, todo el test vive adentro de un único bloque `do $$ ... $$` y la
--     limpieza de los datos de fixture se hace con DELETE explícitos al final del bloque
--     — tanto en el camino feliz como en el bloque `exception` — para no dejar basura en
--     la base local pase lo que pase.
--   * Si una aserción falla, el bloque hace `raise exception` con un mensaje explícito:
--     eso hace que `supabase db query` termine con exit code != 0 (falla visible en CI/
--     terminal) y aun así corre la limpieza antes de re-lanzar el error.
--   * Los fixtures (usuarios/familias/membresías) usan UUIDs fijos que no deberían
--     colisionar con datos reales de desarrollo; igual se borran siempre al final.

do $$
declare
  user1 constant uuid := '11111111-1111-1111-1111-111111111111';
  user2 constant uuid := '22222222-2222-2222-2222-222222222222';
  family1 constant uuid := 'a1111111-1111-1111-1111-111111111111'; -- de user1
  family2 constant uuid := 'b2222222-2222-2222-2222-222222222222'; -- de user2
  matched int;
  affected int;
begin
  -- 1) Fixture: se crea como `postgres` (bypassa RLS) para no depender de las policies
  --    que estamos por probar.
  insert into auth.users (id) values (user1), (user2);

  insert into families (id, name, created_by) values
    (family1, 'Familia de user1', user1),
    (family2, 'Familia de user2', user2);

  insert into family_members (family_id, user_id, role) values
    (family1, user1, 'admin'),
    (family2, user2, 'admin');

  -- 2) A partir de acá actuamos como el rol `authenticated` (el que usa PostgREST/la app),
  --    no como `postgres`/`service_role`, que bypassean RLS.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user2::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user2 then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user2;
  end if;

  -- 3) Control positivo: user2 tiene que poder ver SU PROPIA familia y membresía. Si esto
  --    fallara, un "0 filas" en los pasos siguientes no probaría aislamiento, probaría que
  --    RLS bloquea todo (bug distinto, pero igual de grave).
  select count(*) into matched from families where id = family2;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user2 no puede ver su propia familia (% filas)', matched;
  end if;

  select count(*) into matched from family_members where family_id = family2 and user_id = user2;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user2 no puede ver su propia membresía (% filas)', matched;
  end if;

  -- 4) Aislamiento: user2 NO puede ver la familia de user1.
  select count(*) into matched from families where id = family1;
  if matched <> 0 then
    raise exception 'FALLO RLS: user2 pudo hacer SELECT de la familia de user1 (% filas)', matched;
  end if;

  -- 5) Aislamiento: user2 NO puede actualizar la familia de user1 (no hay policy de
  --    UPDATE en `families`, así que esto debe afectar 0 filas, no explotar).
  update families set name = 'hackeado' where id = family1;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user2 pudo hacer UPDATE de la familia de user1 (% filas)', affected;
  end if;

  -- 6) Aislamiento: user2 NO puede borrar la familia de user1.
  delete from families where id = family1;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user2 pudo hacer DELETE de la familia de user1 (% filas)', affected;
  end if;

  -- 7) Aislamiento: user2 NO puede ver la membresía de user1.
  select count(*) into matched from family_members where family_id = family1 and user_id = user1;
  if matched <> 0 then
    raise exception 'FALLO RLS: user2 pudo hacer SELECT de la membresía de user1 (% filas)', matched;
  end if;

  -- 8) Aislamiento: user2 NO puede actualizar la membresía de user1 (no hay policy de
  --    UPDATE en `family_members`).
  update family_members set role = 'admin' where family_id = family1 and user_id = user1;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user2 pudo hacer UPDATE de la membresía de user1 (% filas)', affected;
  end if;

  -- 9) Aislamiento: user2 NO puede borrar la membresía de user1.
  delete from family_members where family_id = family1 and user_id = user1;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user2 pudo hacer DELETE de la membresía de user1 (% filas)', affected;
  end if;

  -- 10) Aislamiento: user2 NO puede "unirse" a la familia de user1 insertando su propia
  --     fila de membresía ahí (no es quien la creó). Esto debe fallar con una violación de
  --     RLS (insufficient_privilege), no con un insert silenciosamente ignorado.
  begin
    insert into family_members (family_id, user_id, role) values (family1, user2, 'cuidador');
    raise exception 'FALLO RLS: user2 pudo unirse (INSERT) a la familia de user1';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  raise notice 'PGM-15 RLS smoke test: OK (todas las aserciones de aislamiento pasaron)';

  -- 11) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS para
  --     poder borrar todo lo que insertamos.
  reset role;
  delete from family_members where family_id in (family1, family2);
  delete from families where id in (family1, family2);
  delete from auth.users where id in (user1, user2);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la
    -- base local aunque una aserción haya fallado.
    reset role;
    delete from family_members where family_id in (family1, family2);
    delete from families where id in (family1, family2);
    delete from auth.users where id in (user1, user2);
    raise;
end $$;
