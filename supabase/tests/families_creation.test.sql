-- Regresión del bug real de creación de familia (ver comentario extenso en
-- supabase/migrations/20260917200753_fix_families_select_for_creator.sql):
-- `INSERT INTO families ... RETURNING` fallaba con 42501 para el propio
-- creador, porque Postgres aplica la policy de SELECT a las filas
-- devueltas por RETURNING, y esa policy exigía ya ser miembro de la
-- familia -- imposible en el instante de crearla (la fila de
-- family_members se crea recién en el paso siguiente del mismo flujo).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:families-creation
--
-- Mismas convenciones que supabase/tests/is_family_member.test.sql: un
-- único bloque `do $$ ... $$`, limpieza explícita en el camino feliz y en
-- `exception`, UUIDs fijos sin colisión con otros archivos de test
-- (prefijo 95.../a95...).

do $$
declare
  creator constant uuid := '95111111-1111-1111-1111-111111111111';
  other_user constant uuid := '95222222-2222-2222-2222-222222222222';
  new_family_id uuid;
  returned_name text;
  visible_to_other boolean;
begin
  insert into auth.users (id) values (creator), (other_user);

  -- Actuamos como `authenticated`, logueados como el creador -- el caso
  -- real: familyService.createFamily() corre bajo este rol, nunca bajo
  -- `postgres`/`service_role`.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', creator::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from creator then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), creator;
  end if;

  -- 1) CASO CRÍTICO (el bug): el INSERT con RETURNING, tal cual lo hace
  --    familyService.createFamily(), no debe fallar por RLS para el propio
  --    creador aunque todavía no exista su fila en family_members.
  insert into families (name, created_by)
  values ('Familia de Test', creator)
  returning id, name into new_family_id, returned_name;

  if new_family_id is null or returned_name is distinct from 'Familia de Test' then
    raise exception 'FALLO: el INSERT ... RETURNING de families no devolvió la fila esperada (id=%, name=%)', new_family_id, returned_name;
  end if;

  -- 2) Paso siguiente del mismo flujo: el creador se inserta a sí mismo
  --    como admin. No debe fallar (la policy de family_members depende de
  --    poder ver la familia recién creada).
  insert into family_members (family_id, user_id, role)
  values (new_family_id, creator, 'admin');

  -- 3) Aislamiento: otro usuario, que no creó ni es miembro de esta
  --    familia, no debe poder verla -- el fix no debe aflojar RLS más allá
  --    del propio creador.
  reset role;
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', other_user::text, 'role', 'authenticated')::text,
    true
  );

  select exists (select 1 from families where id = new_family_id) into visible_to_other;
  if visible_to_other is distinct from false then
    raise exception 'FALLO RLS: other_user pudo ver una familia que no creó ni de la que es miembro';
  end if;

  raise notice 'families_creation regression test: OK';

  reset role;
  delete from family_members where family_id = new_family_id;
  delete from families where id = new_family_id;
  delete from auth.users where id in (creator, other_user);

exception
  when others then
    reset role;
    delete from family_members where family_id = new_family_id;
    delete from families where id = new_family_id;
    delete from auth.users where id in (creator, other_user);
    raise;
end $$;
