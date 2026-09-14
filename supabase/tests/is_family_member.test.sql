-- PGM-4/T3: smoke test genérico del helper is_family_member(), independiente de cualquier
-- tabla de feature (shifts/medications ya lo ejercitan implícitamente, pero atado a su
-- propia lógica de negocio -- este test prueba el helper en aislamiento, como pide el
-- alcance de PGM-4/T3: "usuario A no puede leer/operar sobre datos de familia B").
--
-- Cubre el caso que motivó el helper (ver comment on function is_family_member, PGM-25):
-- bajo el rol `authenticated`, una subquery directa a `family_members` para preguntar por
-- la membresía de OTRO usuario se reduce silenciosamente a "ese otro usuario = auth.uid()"
-- por la policy `family_members_select_own`. is_family_member() debe seguir devolviendo la
-- respuesta REAL (bypaseando esa RLS) incluso invocado bajo `authenticated`.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:rls-helper
--
-- Mismas convenciones que supabase/tests/rls_isolation.test.sql: un único bloque
-- `do $$ ... $$` (supabase db query -f solo acepta un statement top-level), limpieza
-- explícita en el camino feliz y en `exception`, UUIDs fijos sin colisión con otros
-- archivos de test (prefijo 94.../a94...).

do $$
declare
  user_a constant uuid := '94111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_c constant uuid := '94333333-3333-3333-3333-333333333333'; -- cuidador, familia A (2do miembro real)
  user_b constant uuid := '94222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  family_a constant uuid := 'a9411111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a9422222-2222-2222-2222-222222222222';
  result boolean;
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

  -- 2) A partir de acá actuamos como `authenticated`, logueados como user_a -- el caso
  --    real de uso: is_family_member() se llama desde dentro de una policy que corre bajo
  --    este rol, nunca bajo `postgres`/`service_role`.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- 3) Reflexivo: user_a es miembro de su propia familia.
  select is_family_member(family_a, user_a) into result;
  if result is distinct from true then
    raise exception 'FALLO is_family_member(): user_a debería ser miembro de family_a (obtuvo %)', result;
  end if;

  -- 4) CASO CRÍTICO (el bug que motivó el helper, PGM-25): user_a, logueado, pregunta por
  --    OTRO usuario (user_c) que SÍ es miembro real de la MISMA familia. Sin el bypass de
  --    security definer, la subquery a family_members se reduciría a "user_c = auth.uid()"
  --    (falso) y esto devolvería false incorrectamente.
  select is_family_member(family_a, user_c) into result;
  if result is distinct from true then
    raise exception 'FALLO is_family_member(): user_c es miembro REAL de family_a pero is_family_member() devolvió % -- el helper no está bypaseando la RLS de family_members como se esperaba', result;
  end if;

  -- 5) Aislamiento: user_b (admin de family_b) NO es miembro de family_a.
  select is_family_member(family_a, user_b) into result;
  if result is distinct from false then
    raise exception 'FALLO RLS: is_family_member(family_a, user_b) devolvió % -- user_b no es miembro de family_a y debería dar false', result;
  end if;

  -- 6) Aislamiento simétrico: user_a NO es miembro de family_b (la familia "del otro").
  --    Este es el caso mínimo pedido por el alcance de PGM-4/T3: "usuario A no puede
  --    operar sobre datos de familia B", expresado a nivel del helper genérico.
  select is_family_member(family_b, user_a) into result;
  if result is distinct from false then
    raise exception 'FALLO RLS: is_family_member(family_b, user_a) devolvió % -- user_a no es miembro de family_b y debería dar false', result;
  end if;

  -- 7) Familia inexistente: no debe explotar, debe dar false (exists() sobre 0 filas).
  select is_family_member('00000000-0000-0000-0000-000000000000'::uuid, user_a) into result;
  if result is distinct from false then
    raise exception 'FALLO: is_family_member() con family_id inexistente debería dar false (obtuvo %)', result;
  end if;

  raise notice 'PGM-4/T3 is_family_member() smoke test: OK (helper genérico verificado en aislamiento)';

  -- 8) Limpieza del fixture (camino feliz).
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
