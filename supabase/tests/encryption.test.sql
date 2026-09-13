-- PGM-3: smoke test de cifrado en reposo (extensions.encrypt_text / decrypt_text).
--
-- Verifica el invariante no negociable de esta issue (RGPD art. 9): los campos de salud
-- se guardan cifrados en disco, no en texto plano, y el ciclo cifrar → descifrar funciona
-- de punta a punta contra la tabla de PoC `_encryption_poc`.
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README. Sin eso, este test falla con el mismo error que
--       fallaría la app real (fail fast: "app.settings.encryption_key no está configurada"). ***
--   npm run test:encryption
--
-- Requisitos de la corrida (mismo patrón que rls_isolation.test.sql de PGM-15):
--   * Corre contra el Postgres local de Supabase (`supabase db query --local`), nunca
--     contra staging/prod.
--   * `supabase db query -f` solo acepta UN statement top-level, así que todo el test
--     vive en un único bloque `do $$ ... $$`, con limpieza explícita del fixture al final
--     -- tanto en el camino feliz como en el bloque `exception`.
--   * Si una aserción falla, el bloque hace `raise exception`, lo que hace que
--     `supabase db query` termine con exit code != 0 (falla visible en terminal/CI).
--   * El fixture usa UUIDs fijos que no deberían colisionar con datos reales de
--     desarrollo; igual se borran siempre al final.

do $$
declare
  user1 constant uuid := '33333333-3333-3333-3333-333333333333';
  poc_id uuid;
  plain constant text := 'nota médica de prueba: hipertensión controlada';
  cipher1 bytea;
  cipher2 bytea;
  decrypted text;
  matched int;
begin
  -- 0) Fixture: usuario dueño de la fila de PoC. Se crea como `postgres` (bypassa RLS).
  insert into auth.users (id) values (user1);

  -- 1) Null-safety: cifrar/descifrar NULL debe devolver NULL, nunca explotar ni producir
  --    un valor "vacío pero cifrado".
  if extensions.encrypt_text(null) is not null then
    raise exception 'FALLO: encrypt_text(null) debería devolver null';
  end if;

  if extensions.decrypt_text(null) is not null then
    raise exception 'FALLO: decrypt_text(null) debería devolver null';
  end if;

  -- 2) Dos cifrados del mismo texto plano deben dar ciphertexts DISTINTOS (salt/IV
  --    aleatorio de pgp_sym_encrypt) -- si dieran igual, sería un cifrado determinista,
  --    lo cual facilita ataques de análisis de patrones sobre datos de salud.
  cipher1 := extensions.encrypt_text(plain);
  cipher2 := extensions.encrypt_text(plain);

  if cipher1 = cipher2 then
    raise exception 'FALLO: dos cifrados del mismo texto dieron el mismo ciphertext (no debería ser determinista)';
  end if;

  -- 3) El ciphertext no debe contener el texto plano en ninguna forma reconocible.
  --    Comparamos representaciones hex (texto ASCII seguro) en vez de castear el bytea
  --    del ciphertext a texto/UTF-8 -- el ciphertext es binario arbitrario y castearlo
  --    directo con convert_from() puede fallar con "invalid byte sequence for encoding
  --    UTF8" en corridas donde el ciphertext no resulta ser UTF-8 válido (no es un bug
  --    del cifrado, es simplemente binario).
  if position(encode(convert_to(plain, 'utf8'), 'hex') in encode(cipher1, 'hex')) > 0 then
    raise exception 'FALLO: el ciphertext contiene el texto plano sin cifrar';
  end if;

  -- 4) Descifrar cualquiera de los dos ciphertexts debe devolver el texto plano original.
  if extensions.decrypt_text(cipher1) is distinct from plain then
    raise exception 'FALLO: decrypt_text(cipher1) no devolvió el texto plano original';
  end if;

  if extensions.decrypt_text(cipher2) is distinct from plain then
    raise exception 'FALLO: decrypt_text(cipher2) no devolvió el texto plano original';
  end if;

  -- 5) Ciclo completo insert → select con descifrado, contra la tabla de PoC, actuando
  --    como el rol `authenticated` (el que usa PostgREST/la app), no como `postgres`.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user1::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user1 then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user1;
  end if;

  insert into _encryption_poc (owner_id, secret_cipher)
  values (user1, extensions.encrypt_text(plain))
  returning id into poc_id;

  select secret_cipher, extensions.decrypt_text(secret_cipher)
    into cipher1, decrypted
    from _encryption_poc
    where id = poc_id;

  if decrypted is distinct from plain then
    raise exception 'FALLO: select-descifrado desde _encryption_poc no devolvió el texto plano original (obtuvo: %)', decrypted;
  end if;

  if position(encode(convert_to(plain, 'utf8'), 'hex') in encode(cipher1, 'hex')) > 0 then
    raise exception 'FALLO: la columna secret_cipher en disco contiene el texto plano sin cifrar';
  end if;

  select count(*) into matched from _encryption_poc where id = poc_id;
  if matched <> 1 then
    raise exception 'FALLO: no se pudo releer la fila propia recién insertada (% filas)', matched;
  end if;

  raise notice 'PGM-3 encryption smoke test: OK (cifrado/descifrado, salt aleatorio, null-safety y ciclo insert/select verificados)';

  -- 6) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from _encryption_poc where id = poc_id;
  delete from auth.users where id = user1;

exception
  when others then
    -- Limpieza del fixture también en el camino de error.
    reset role;
    delete from _encryption_poc where owner_id = user1;
    delete from auth.users where id = user1;
    raise;
end $$;
