-- PGM-27: smoke test de aislamiento RLS para `list_family_members(p_family_id)`.
--
-- Verifica:
--   1) Caso positivo: un miembro real de la familia puede listar a TODOS los miembros de su
--      propia familia (incluida su propia fila) -- el caso que la RLS estándar de
--      family_members NO permite sin este helper (ver nota de la migración).
--   2) Aislamiento: un usuario que NO es miembro de p_family_id recibe un conjunto VACÍO, no
--      un error ni las filas reales -- nunca debe filtrarse ni siquiera "cuántos miembros
--      tiene" una familia ajena.
--   3) Familia inexistente: conjunto vacío, sin excepción.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:list-family-members
--
-- Mismas convenciones que supabase/tests/is_family_member.test.sql / shifts.test.sql: un
-- único bloque `do $$ ... $$`, limpieza explícita en el camino feliz y en `exception`,
-- UUIDs fijos sin colisión con otros archivos de test (prefijo 95.../a95...).

do $$
declare
  user_a constant uuid := '95111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_c constant uuid := '95333333-3333-3333-3333-333333333333'; -- cuidador, familia A (2do miembro real)
  user_b constant uuid := '95222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  family_a constant uuid := 'a9511111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a9522222-2222-2222-2222-222222222222';
  member_count int;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS), dos familias con miembros reales.
  insert into auth.users (id) values (user_a), (user_b), (user_c);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_c, 'cuidador'),
    (family_b, user_b, 'admin');

  -- 2) A partir de acá actuamos como `authenticated`, logueados como user_a.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- 3) CASO POSITIVO: user_a puede listar a los DOS miembros reales de su propia familia
  --    (incluida su propia fila) -- esto es justo lo que family_members_select_own por sí
  --    sola NO permite.
  select count(*) into member_count
  from list_family_members(family_a)
  where user_id in (user_a, user_c);
  if member_count <> 2 then
    raise exception 'FALLO list_family_members(): user_a debería ver 2 miembros de family_a (obtuvo %)', member_count;
  end if;

  select count(*) into member_count from list_family_members(family_a) where user_id = user_a and role = 'admin';
  if member_count <> 1 then
    raise exception 'FALLO list_family_members(): falta o rol incorrecto para user_a (admin) en family_a';
  end if;

  select count(*) into member_count from list_family_members(family_a) where user_id = user_c and role = 'cuidador';
  if member_count <> 1 then
    raise exception 'FALLO list_family_members(): falta o rol incorrecto para user_c (cuidador) en family_a';
  end if;

  -- 4) AISLAMIENTO CRÍTICO: user_a (NO es miembro de family_b) pide list_family_members de
  --    family_b -- debe recibir CERO filas, no las filas reales de esa familia ajena.
  select count(*) into member_count from list_family_members(family_b);
  if member_count <> 0 then
    raise exception 'FALLO RLS: list_family_members(family_b) devolvió % filas a user_a, que NO es miembro de esa familia -- fuga de datos entre familias', member_count;
  end if;

  -- 5) Familia inexistente: conjunto vacío, sin excepción.
  select count(*) into member_count from list_family_members('00000000-0000-0000-0000-000000000000'::uuid);
  if member_count <> 0 then
    raise exception 'FALLO: list_family_members() con family_id inexistente debería devolver 0 filas (obtuvo %)', member_count;
  end if;

  raise notice 'PGM-27 list_family_members() smoke test: OK (picker de asignación habilitado sin fuga entre familias)';

  -- 6) Limpieza del fixture (camino feliz).
  reset role;
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b, user_c);

exception
  when others then
    -- Limpieza del fixture también en el camino de error.
    reset role;
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b, user_c);
    raise;
end $$;
