-- PGM-10: smoke test de aislamiento RLS para push_tokens y de las RPC de conveniencia
-- register_push_token() / unregister_push_token().
--
-- Verifica los invariantes no negociables de esta issue:
--   1) Aislamiento RLS dueño-only: un usuario NO puede ver/modificar/borrar/insertar
--      push_tokens de otro usuario, incluso sin ninguna familia de por medio (a diferencia
--      del resto del dominio, esta tabla aísla por user_id directo, no por family_id -- ver
--      nota de diseño en supabase/migrations/20260915120000_push_tokens.sql).
--   2) register_push_token(): siempre escribe user_id = auth.uid() (nunca un parámetro
--      libre), hace upsert por (user_id, device) sin acumular filas duplicadas del mismo
--      dispositivo, y valida device/expo_token/platform server-side.
--   3) unregister_push_token(): borra únicamente el propio token del device indicado, y es
--      idempotente (no falla si no hay nada que borrar).
--   4) UNIQUE (user_id, device): un INSERT directo que la viole falla con unique_violation.
--
-- Mismo patrón de ejecución que el resto de los tests de este proyecto (ver
-- supabase/tests/shift_handovers.test.sql para el criterio detallado de fixture con
-- `postgres` + verificación bajo `authenticated`):
--   npm run db:start   (una vez, si el stack local no está arriba)
--   npm run test:push-tokens
--
-- No depende de la GUC app.settings.encryption_key -- esta tabla no tiene columnas cifradas
-- (expo_token no es un dato de salud, ver nota de diseño en la migración).

do $$
declare
  user_a constant uuid := '91111111-1111-1111-1111-111111111111';
  user_b constant uuid := '92222222-2222-2222-2222-222222222222';
  token_a constant uuid := '93111111-1111-1111-1111-111111111111';
  token_b constant uuid := '93222222-2222-2222-2222-222222222222';
  device_a constant text := 'device-a-uuid-fixture';
  device_b constant text := 'device-b-uuid-fixture';
  matched int;
  affected int;
  registered_id uuid;
  registered_user_id uuid;
  registered_expo_token text;
  registered_platform text;
  registered_count int;
  raised_sqlstate text;
begin
  -- 1) Fixture: dos usuarios, sin familias (push_tokens no depende de ellas). Se crea como
  --    `postgres` (bypassa RLS), igual que el resto de los tests de este proyecto.
  insert into auth.users (id) values (user_a), (user_b);

  insert into push_tokens (id, user_id, device, expo_token, platform) values
    (token_a, user_a, device_a, 'ExponentPushToken[fixture-a]', 'android'),
    (token_b, user_b, device_b, 'ExponentPushToken[fixture-b]', 'ios');

  -- 2) A partir de acá actuamos como el rol `authenticated`, logueados como user_a.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- 3) Control positivo: user_a ve su propio token.
  select count(*) into matched from push_tokens where id = token_a;
  if matched <> 1 then
    raise exception 'CONTROL POSITIVO FALLÓ: user_a no puede ver su propio push_token (% filas)', matched;
  end if;

  -- 4) Aislamiento SELECT: user_a no ve el token de user_b.
  select count(*) into matched from push_tokens where id = token_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer SELECT del push_token de user_b (% filas)', matched;
  end if;

  -- 5) Aislamiento UPDATE: user_a no puede modificar el token de user_b.
  update push_tokens set expo_token = 'ExponentPushToken[hackeado]' where id = token_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer UPDATE del push_token de user_b (% filas)', affected;
  end if;

  -- 6) Aislamiento DELETE: user_a no puede borrar el token de user_b.
  delete from push_tokens where id = token_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FALLO RLS: user_a pudo hacer DELETE del push_token de user_b (% filas)', affected;
  end if;

  -- 7) Aislamiento INSERT: user_a no puede insertar un push_token "a nombre de" user_b (el
  --    with check de push_tokens_insert_own debe bloquearlo).
  begin
    insert into push_tokens (user_id, device, expo_token, platform)
    values (user_b, 'device-intruso', 'ExponentPushToken[intruso]', 'android');
    raise exception 'FALLO RLS: user_a pudo insertar un push_token a nombre de user_b';
  exception
    when insufficient_privilege then
      null; -- esperado: RLS bloqueó el insert.
  end;

  -- 8) Caso positivo: user_a SÍ puede insertar un push_token propio para otro dispositivo.
  insert into push_tokens (user_id, device, expo_token, platform)
  values (user_a, 'device-a-segundo', 'ExponentPushToken[fixture-a-2]', 'android');

  select count(*) into matched
    from push_tokens
    where user_id = user_a and device = 'device-a-segundo';
  if matched <> 1 then
    raise exception 'FALLO: user_a no pudo insertar un push_token propio para otro dispositivo (% filas)', matched;
  end if;

  -- 9) UNIQUE (user_id, device): un segundo INSERT directo para el mismo (user_id, device)
  --    debe fallar con unique_violation (register_push_token(), probado más abajo, es la
  --    forma correcta de "actualizar" -- un INSERT directo duplicado no debe colarse).
  begin
    insert into push_tokens (user_id, device, expo_token, platform)
    values (user_a, device_a, 'ExponentPushToken[duplicado]', 'android');
    raise exception 'FALLO CONSTRAINT: se pudo insertar un push_token duplicado para (user_id, device)';
  exception
    when unique_violation then
      null; -- esperado.
  end;

  -- 10) register_push_token(): crea la fila con user_id = auth.uid() SIEMPRE (la función no
  --     acepta ningún parámetro user_id), aunque el dispositivo sea nuevo.
  select id, user_id, expo_token, platform
    into registered_id, registered_user_id, registered_expo_token, registered_platform
    from register_push_token('device-a-nuevo', 'ExponentPushToken[nuevo]', 'android');

  if registered_user_id is distinct from user_a then
    raise exception 'FALLO: register_push_token() no fijó user_id = auth.uid() (obtuvo %)', registered_user_id;
  end if;
  if registered_expo_token is distinct from 'ExponentPushToken[nuevo]' then
    raise exception 'FALLO: register_push_token() no devolvió el expo_token esperado (obtuvo %)', registered_expo_token;
  end if;

  -- 11) register_push_token() es upsert: llamarlo de nuevo con el MISMO device y un token
  --     distinto actualiza la fila existente, no crea una segunda.
  perform register_push_token('device-a-nuevo', 'ExponentPushToken[rotado]', 'ios');

  select count(*) into registered_count
    from push_tokens
    where user_id = user_a and device = 'device-a-nuevo';
  if registered_count <> 1 then
    raise exception 'FALLO UPSERT: register_push_token() generó % filas para el mismo (user_id, device) en vez de 1', registered_count;
  end if;

  select expo_token, platform into registered_expo_token, registered_platform
    from push_tokens
    where user_id = user_a and device = 'device-a-nuevo';
  if registered_expo_token is distinct from 'ExponentPushToken[rotado]' then
    raise exception 'FALLO UPSERT: register_push_token() no actualizó expo_token (obtuvo %)', registered_expo_token;
  end if;
  if registered_platform is distinct from 'ios' then
    raise exception 'FALLO UPSERT: register_push_token() no actualizó platform (obtuvo %)', registered_platform;
  end if;

  -- 12) register_push_token(): validación server-side -- device vacío.
  begin
    perform register_push_token('', 'ExponentPushToken[x]', 'android');
    raise exception 'FALLO VALIDACIÓN: register_push_token() aceptó un device vacío';
  exception
    when others then
      get stacked diagnostics raised_sqlstate = returned_sqlstate;
      if raised_sqlstate <> '22023' then
        raise exception 'FALLO VALIDACIÓN: register_push_token() con device vacío lanzó sqlstate % (esperado 22023)', raised_sqlstate;
      end if;
  end;

  -- 13) register_push_token(): validación server-side -- expo_token vacío.
  begin
    perform register_push_token('device-x', '   ', 'android');
    raise exception 'FALLO VALIDACIÓN: register_push_token() aceptó un expo_token vacío';
  exception
    when others then
      get stacked diagnostics raised_sqlstate = returned_sqlstate;
      if raised_sqlstate <> '22023' then
        raise exception 'FALLO VALIDACIÓN: register_push_token() con expo_token vacío lanzó sqlstate % (esperado 22023)', raised_sqlstate;
      end if;
  end;

  -- 14) register_push_token(): validación server-side -- platform inválida.
  begin
    perform register_push_token('device-x', 'ExponentPushToken[x]', 'windows-phone');
    raise exception 'FALLO VALIDACIÓN: register_push_token() aceptó platform = windows-phone';
  exception
    when others then
      get stacked diagnostics raised_sqlstate = returned_sqlstate;
      if raised_sqlstate <> '22023' then
        raise exception 'FALLO VALIDACIÓN: register_push_token() con platform inválida lanzó sqlstate % (esperado 22023)', raised_sqlstate;
      end if;
  end;

  -- 15) unregister_push_token(): borra el propio token del device indicado.
  perform unregister_push_token('device-a-nuevo');

  select count(*) into matched
    from push_tokens
    where user_id = user_a and device = 'device-a-nuevo';
  if matched <> 0 then
    raise exception 'FALLO: unregister_push_token() no borró el push_token del device indicado (% filas restantes)', matched;
  end if;

  -- 16) unregister_push_token(): idempotente -- no falla si no hay nada que borrar.
  begin
    perform unregister_push_token('device-que-no-existe');
  exception
    when others then
      raise exception 'FALLO: unregister_push_token() no debería lanzar excepción para un device inexistente';
  end;

  -- 17) Aislamiento de las RPC: user_a no puede usar unregister_push_token() para borrar el
  --     token de user_b (la función filtra siempre por user_id = auth.uid(), no por un
  --     parámetro user_id que ni siquiera existe). Se llama pasándole el device de user_b
  --     -- debe ser un no-op. La verificación se hace con `reset role` (bypassa RLS): bajo
  --     `authenticated` como user_a, un SELECT nunca vería la fila de user_b de todos modos
  --     (RLS de SELECT), así que comprobar "matched = 1" bajo ese mismo rol no probaría nada
  --     -- solo confirmaría la RLS de SELECT (ya cubierta en el paso 4), no si el DELETE la
  --     alcanzó a borrar.
  perform unregister_push_token(device_b);

  reset role;
  select count(*) into matched from push_tokens where id = token_b;
  if matched <> 1 then
    raise exception 'FALLO RLS: unregister_push_token() de user_a afectó el push_token de user_b';
  end if;

  raise notice 'PGM-10 push_tokens smoke test: OK (aislamiento RLS dueño-only, upsert y validación de register_push_token(), unregister_push_token() verificados)';

  -- 18) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from push_tokens where user_id in (user_a, user_b);
  delete from auth.users where id in (user_a, user_b);

exception
  when others then
    -- Limpieza del fixture también en el camino de error, para no dejar basura en la base
    -- local aunque una aserción haya fallado.
    reset role;
    delete from push_tokens where user_id in (user_a, user_b);
    delete from auth.users where id in (user_a, user_b);
    raise;
end $$;
