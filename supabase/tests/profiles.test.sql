-- PGM-backend: smoke test de la tabla `profiles` -- cierra el TODO de PGM-20.
--
-- Verifica los invariantes no negociables de esta issue:
--   1) Un usuario puede insertar/leer/actualizar su propio perfil.
--   2) Un usuario NO puede leer el perfil de otro usuario (dueño-only, sin lectura
--      cruzada entre miembros de la familia -- ver nota de diseño en la migración).
--   3) Un usuario NO puede insertar/actualizar un perfil a nombre de otro usuario.
--   4) `family_id` acepta null (perfil sin familia todavía) y sigue existiendo tras
--      borrar la familia (`on delete set null`, no cascade).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:profiles

do $$
declare
  user_a constant uuid := '98111111-1111-1111-1111-111111111111';
  user_b constant uuid := '98222222-2222-2222-2222-222222222222';
  family_a constant uuid := 'a9811111-1111-1111-1111-111111111111';
  matched int;
  affected int;
  v_display_name text;
  v_family_id uuid;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS).
  insert into auth.users (id) values (user_a), (user_b);
  insert into families (id, name, created_by) values (family_a, 'Familia A', user_a);
  insert into family_members (family_id, user_id, role) values (family_a, user_a, 'admin');

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

  -- 3) Camino feliz: user_a inserta su propio perfil (sin familia todavía -- family_id null).
  insert into profiles (user_id, family_id, display_name, relation_to_cared_person)
  values (user_a, null, 'María López', 'Hija');

  select display_name, family_id into v_display_name, v_family_id
    from profiles where user_id = user_a;
  if v_display_name is distinct from 'María López' then
    raise exception 'FALLO: display_name no se guardó (obtuvo %)', v_display_name;
  end if;
  if v_family_id is not null then
    raise exception 'FALLO: family_id debería ser null (obtuvo %)', v_family_id;
  end if;

  -- 4) user_a actualiza su propio perfil (ahora con familia).
  update profiles set family_id = family_a, relation_to_cared_person = 'Hija mayor'
    where user_id = user_a;

  select relation_to_cared_person into v_display_name from profiles where user_id = user_a;
  if v_display_name is distinct from 'Hija mayor' then
    raise exception 'FALLO: update no se aplicó (obtuvo %)', v_display_name;
  end if;

  -- 5) user_a NO puede insertar un perfil a nombre de user_b.
  begin
    insert into profiles (user_id, display_name) values (user_b, 'Intruso');
    raise exception 'FALLO RLS: user_a pudo insertar un perfil a nombre de user_b';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  -- 6) Insertamos el perfil de user_b como `postgres` (bypassa RLS) para probar aislamiento.
  reset role;
  insert into profiles (user_id, display_name) values (user_b, 'Perfil de B');
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  -- 7) user_a NO puede leer el perfil de user_b.
  select count(*) into matched from profiles where user_id = user_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo leer el perfil de user_b (% filas)', matched;
  end if;

  -- 8) user_a NO puede actualizar el perfil de user_b.
  update profiles set display_name = 'Hackeado' where user_id = user_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo actualizar el perfil de user_b (% filas)', affected;
  end if;

  -- 9) family_id sobrevive al borrado de la familia como null (on delete set null, no cascade).
  reset role;
  delete from family_members where family_id = family_a;
  delete from families where id = family_a;

  select count(*) into matched from profiles where user_id = user_a;
  if matched <> 1 then
    raise exception 'FALLO: el perfil de user_a no debería borrarse al borrar la familia (% filas)', matched;
  end if;

  select family_id into v_family_id from profiles where user_id = user_a;
  if v_family_id is not null then
    raise exception 'FALLO: family_id debería quedar en null tras borrar la familia (obtuvo %)', v_family_id;
  end if;

  raise notice 'PGM-backend profiles smoke test: OK (dueño-only, aislamiento y on delete set null verificados)';

  -- 10) Limpieza del fixture (camino feliz).
  delete from profiles where user_id in (user_a, user_b);
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    reset role;
    delete from profiles where user_id in (user_a, user_b);
    delete from family_members where family_id = family_a;
    delete from families where id = family_a;
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
