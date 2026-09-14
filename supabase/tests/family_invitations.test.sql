-- PGM-19: smoke test de `family_invitations` / `create_family_invitation()` /
-- `accept_family_invitation()`.
--
-- Verifica:
--   1) Permisos de creación: solo un admin (o el creador) de la familia puede crear una
--      invitación para ella -- un cuidador no-admin de la MISMA familia, o el admin de OTRA
--      familia, deben ser rechazados con insufficient_privilege (RLS, family_invitations_insert_admin).
--   2) Validación de `p_ttl`: un intervalo no positivo se rechaza con un mensaje legible.
--   3) Visibilidad: solo un admin de la familia puede leer sus invitaciones
--      (family_invitations_select_admin) -- un cuidador no-admin de la misma familia no ve
--      la fila aunque exista.
--   4) CASO POSITIVO CRÍTICO: un usuario nuevo (sin familia) acepta una invitación válida ->
--      queda insertado en family_members con role = 'cuidador', y accept_family_invitation()
--      devuelve (family_id, role) correctos.
--   5) Un token ya usado no se puede volver a aceptar (mensaje legible, no un error crudo).
--   6) Un token inexistente se rechaza con un mensaje legible.
--   7) Un token expirado se rechaza con un mensaje legible.
--   8) Un usuario que YA es miembro de la familia no puede aceptar otra invitación a esa
--      misma familia (mensaje legible, no un unique_violation crudo).
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:family-invitations
--
-- Mismas convenciones que el resto de supabase/tests/*.sql (ver shifts.test.sql/
-- is_family_member.test.sql): un único bloque `do $$ ... $$` (supabase db query -f solo
-- acepta un statement top-level), limpieza explícita del fixture en el camino feliz y en
-- `exception`, UUIDs fijos con prefijo 96/a96 sin colisión con otros archivos de test.

do $$
declare
  user_a constant uuid := '96111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_b constant uuid := '96222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  user_c constant uuid := '96333333-3333-3333-3333-333333333333'; -- cuidador, familia A (miembro no-admin)
  user_d constant uuid := '96444444-4444-4444-4444-444444444444'; -- usuario nuevo, sin familia (happy path)
  user_e constant uuid := '96555555-5555-5555-5555-555555555555'; -- usuario nuevo, sin familia (tokens inválido/expirado)
  family_a constant uuid := 'a9611111-1111-1111-1111-111111111111';
  family_b constant uuid := 'a9622222-2222-2222-2222-222222222222';
  expired_invitation_id constant uuid := 'a9611111-9999-1111-1111-111111111111';
  expired_token constant uuid := 'a9611111-9999-2222-2222-222222222222';
  v_token uuid;
  v_expires timestamptz;
  v_token2 uuid;
  v_out_family_id uuid;
  v_out_role text;
  matched int;
  rejected boolean;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS), dos familias; family_a con dos miembros
  --    reales (admin + cuidador no-admin).
  insert into auth.users (id) values (user_a), (user_b), (user_c), (user_d), (user_e);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_c, 'cuidador'),
    (family_b, user_b, 'admin');

  -- Fixture de un token ya expirado, insertado directamente (bypass RLS) para no depender
  -- de esperar 7 días reales en el test.
  insert into family_invitations (id, family_id, token, created_by, created_at, expires_at)
  values (
    expired_invitation_id, family_a, expired_token, user_a,
    now() - interval '10 days', now() - interval '1 day'
  );

  -- 2) Logueados como user_c (cuidador NO-admin de la Familia A): no puede crear
  --    invitaciones para su propia familia.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_c::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_c then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_c;
  end if;

  begin
    perform create_family_invitation(family_a);
    raise exception 'FALLO RLS: user_c (cuidador NO-admin) pudo crear una invitación para la Familia A';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert (family_invitations_insert_admin).
  end;

  -- 3) Logueados como user_b (admin, pero de la Familia B): tampoco puede crear
  --    invitaciones para la Familia A (no es miembro/admin de esa familia).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_b::text, 'role', 'authenticated')::text,
    true
  );

  begin
    perform create_family_invitation(family_a);
    raise exception 'FALLO RLS: user_b (admin de OTRA familia) pudo crear una invitación para la Familia A';
  exception
    when insufficient_privilege then
      null; -- esperado.
  end;

  -- 4) Logueados como user_a (admin real de la Familia A): puede crear la invitación.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  select token, expires_at into v_token, v_expires
  from create_family_invitation(family_a, 'nuevo@cuidador.test');

  if v_token is null then
    raise exception 'FALLO: create_family_invitation() no devolvió un token';
  end if;

  if v_expires <= now() + interval '6 days' or v_expires >= now() + interval '8 days' then
    raise exception 'FALLO: expires_at fuera del TTL default esperado (~7 días): %', v_expires;
  end if;

  -- 5) p_ttl inválido se rechaza con mensaje legible (no crea la fila).
  begin
    perform create_family_invitation(family_a, null, interval '0');
    raise exception 'FALLO: create_family_invitation() aceptó un p_ttl no positivo';
  exception
    when others then
      if sqlerrm not like '%p_ttl debe ser un intervalo positivo%' then
        raise exception 'FALLO: mensaje inesperado al pasar p_ttl inválido: %', sqlerrm;
      end if;
  end;

  -- 6) Visibilidad: user_a (admin) ve la invitación recién creada.
  select count(*) into matched from family_invitations where token = v_token;
  if matched <> 1 then
    raise exception 'FALLO: user_a (admin) no puede ver la invitación que él mismo creó (% filas)', matched;
  end if;

  -- 7) user_c (cuidador NO-admin, mismo family_a) NO ve las invitaciones de su familia.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_c::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into matched from family_invitations where family_id = family_a;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_c (cuidador NO-admin) pudo ver invitaciones de su familia (% filas)', matched;
  end if;

  -- 8) CASO POSITIVO CRÍTICO: user_d (usuario nuevo, sin familia) acepta la invitación
  --    válida de la Familia A.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_d::text, 'role', 'authenticated')::text,
    true
  );

  select family_id, role into v_out_family_id, v_out_role
  from accept_family_invitation(v_token);

  if v_out_family_id is distinct from family_a or v_out_role is distinct from 'cuidador' then
    raise exception 'FALLO: accept_family_invitation() devolvió (%, %), esperado (%, cuidador)',
      v_out_family_id, v_out_role, family_a;
  end if;

  select count(*) into matched
  from family_members
  where family_id = family_a and user_id = user_d and role = 'cuidador';
  if matched <> 1 then
    raise exception 'FALLO: user_d no quedó insertado en family_members de la Familia A (% filas)', matched;
  end if;

  -- 9) El mismo token ya no se puede volver a aceptar (ni por el mismo usuario ni por otro).
  rejected := false;
  begin
    perform accept_family_invitation(v_token);
  exception
    when others then
      rejected := true;
      if sqlerrm not like '%ya fue utilizada%' then
        raise exception 'FALLO: mensaje inesperado al reaceptar un token ya usado: %', sqlerrm;
      end if;
  end;
  if not rejected then
    raise exception 'FALLO: se pudo volver a aceptar un token ya usado (esperado: rechazo)';
  end if;

  -- 10) Token inexistente: mensaje legible, no una excepción críptica.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_e::text, 'role', 'authenticated')::text,
    true
  );

  rejected := false;
  begin
    perform accept_family_invitation('00000000-0000-0000-0000-000000000000'::uuid);
  exception
    when others then
      rejected := true;
      if sqlerrm not like '%invitación no existe%' then
        raise exception 'FALLO: mensaje inesperado al aceptar un token inexistente: %', sqlerrm;
      end if;
  end;
  if not rejected then
    raise exception 'FALLO: se pudo aceptar un token inexistente (esperado: rechazo)';
  end if;

  -- 11) Token expirado: mensaje legible.
  rejected := false;
  begin
    perform accept_family_invitation(expired_token);
  exception
    when others then
      rejected := true;
      if sqlerrm not like '%expiró%' then
        raise exception 'FALLO: mensaje inesperado al aceptar un token expirado: %', sqlerrm;
      end if;
  end;
  if not rejected then
    raise exception 'FALLO: se pudo aceptar un token expirado (esperado: rechazo)';
  end if;

  -- 12) Un usuario que YA es miembro de la familia no puede aceptar otra invitación a esa
  --     misma familia (mensaje legible, no un unique_violation crudo). user_a ya es admin
  --     de family_a -- generamos una segunda invitación válida para probarlo.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  select token into v_token2 from create_family_invitation(family_a);

  rejected := false;
  begin
    perform accept_family_invitation(v_token2);
  exception
    when others then
      rejected := true;
      if sqlerrm not like '%Ya sos miembro de esta familia%' then
        raise exception 'FALLO: mensaje inesperado al re-aceptar siendo ya miembro: %', sqlerrm;
      end if;
  end;
  if not rejected then
    raise exception 'FALLO: user_a pudo aceptar una invitación a una familia de la que ya es miembro (esperado: rechazo)';
  end if;

  raise notice 'PGM-19 family_invitations smoke test: OK (permisos de creación, visibilidad, aceptación feliz, token usado/inexistente/expirado y ya-miembro verificados)';

  -- 13) Limpieza del fixture (camino feliz).
  reset role;
  delete from family_invitations where family_id in (family_a, family_b);
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b, user_c, user_d, user_e);

exception
  when others then
    -- Limpieza del fixture también en el camino de error.
    reset role;
    delete from family_invitations where family_id in (family_a, family_b);
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b, user_c, user_d, user_e);
    raise;
end $$;
