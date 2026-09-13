-- PGM-3: Estrategia de cifrado en reposo con pgcrypto para campos de salud
--
-- Bloqueante para F2 (cared_persons), F4 (medications/medication_logs) y F5
-- (shift_handovers): esas features van a guardar datos de salud/cuidado en columnas
-- `bytea` cifradas usando las funciones helper que define esta migración. RGPD art. 9:
-- cifrado en reposo de datos de salud es NO NEGOCIABLE (ver docs/product-vision.md).
--
-- Esta migración entrega los 4 puntos que pide la issue:
--   1. Decisión técnica: pgcrypto simétrico vs Supabase Vault (más abajo).
--   2. PoC de cifrado/descifrado: funciones helper + tabla `_encryption_poc` con RLS,
--      probadas end-to-end en supabase/tests/encryption.test.sql (npm run test:encryption).
--   3. Lista de campos a cifrar: sección "CAMPOS DE SALUD A CIFRAR" más abajo.
--   4. Documentación de rotación de claves: sección "ROTACIÓN DE CLAVES" más abajo.
--
-- ============================================================================
-- 1) DECISIÓN TÉCNICA: pgcrypto (simétrico, AES-256) vs Supabase Vault
-- ============================================================================
--
-- Se evaluaron dos opciones para cifrar en reposo los campos de salud:
--
--   a) pgcrypto (contrib de Postgres, ya en uso desde PGM-2/T1 para gen_random_uuid()):
--      cifrado simétrico vía `pgp_sym_encrypt`/`pgp_sym_decrypt`, con AES-256 explícito
--      (`cipher-algo=aes256`) y una única clave leída de una GUC (`app.settings.encryption_key`).
--   b) Supabase Vault (pgsodium + tabla de secretos gestionada por Supabase Cloud):
--      cifrado gestionado con rotación de root key delegada a la infraestructura de
--      Supabase.
--
-- Elegimos (a) pgcrypto para este MVP:
--   - Vault es una feature de Supabase Cloud con soporte y comportamiento distinto entre
--     el stack local (Docker/self-hosted) y los proyectos cloud (staging/prod). Para que
--     dev/staging/prod se comporten IGUAL (requisito de PGM-2), necesitamos algo que
--     funcione idéntico en los tres entornos sin depender de infraestructura gestionada
--     que el stack local no puede replicar fielmente.
--   - pgcrypto es un contrib estándar de Postgres, ya habilitado (T1), sin dependencias
--     nuevas, y nos da control total y explícito sobre la clave y su rotación (ver más
--     abajo) — importante para un equipo chico que necesita entender exactamente qué pasa
--     con la clave, no delegarlo a una caja negra.
--   - Trade-off aceptado conscientemente: no hay KMS/envelope encryption ni rotación
--     automática -- la gestión de la clave es manual (ver rotación más abajo). Aceptable
--     en esta etapa (equipo chico, MVP, beta cerrada); revisar si un futuro requisito de
--     compliance/escala pide un KMS gestionado (AWS KMS, Vault de HashiCorp, o el propio
--     Supabase Vault si para entonces staging/prod son 100% Supabase Cloud).
--
-- ============================================================================
-- 2) SETUP DE LA CLAVE POR ENTORNO
-- ============================================================================
--
-- La clave de cifrado NUNCA se hardcodea en el código ni en una migración: vive en la GUC
-- de Postgres `app.settings.encryption_key`, leída en runtime por
-- `extensions.current_encryption_key()`. Cómo se setea esa GUC es DISTINTO por entorno:
--
-- LOCAL (Docker, `npm run db:start` / `npm run db:reset`):
--   IMPORTANTE -- verificado empíricamente: `supabase db reset` SÍ recrea los roles del
--   clúster de Postgres (no solo el contenido del schema `public`/`extensions`). Eso
--   significa que el `grant set on parameter` de abajo NO sobrevive a un reset: hay que
--   rehacerlo después de CADA `db:start`/`db:reset`, no una sola vez por stack de Docker.
--   Por eso `supabase/seed.sql` intenta setear la GUC automáticamente en cada reset (con
--   manejo gracioso si el grant todavía no se hizo), y por qué el paso 1 de acá abajo
--   sigue siendo un paso MANUAL que hay que repetir vos mismo tras cada reset:
--
--     1. Dar permiso al rol `postgres` para setear esta GUC custom (requiere el rol
--        `supabase_admin`, que sí tiene privilegios de superusuario en el stack local):
--
--          docker exec -i supabase_db_cuidamos psql -U supabase_admin -d postgres -c \
--            'grant set on parameter "app.settings.encryption_key" to postgres;'
--
--     2. Setear la clave de desarrollo (valor fijo, NO sensible -- nunca usar este valor
--        fuera de local):
--
--          docker exec -i supabase_db_cuidamos psql -U postgres -d postgres -c \
--            "alter database postgres set app.settings.encryption_key = \
--             'local-dev-only-insecure-key-do-not-use-in-staging-or-prod';"
--
--   `seed.sql` repite el paso 2 automáticamente en cada `db:reset` (mismo valor), pero
--   el paso 1 (el grant) hay que correrlo a mano vos mismo cada vez -- ver README.
--
-- STAGING / PROD-CERRADO (Supabase Cloud):
--   No hay acceso a `docker exec`/superusuario del clúster gestionado. La clave se setea
--   vía el soporte de Supabase Cloud (Dashboard → Database → Custom Postgres Config, o
--   pidiendo el cambio a soporte si esa GUC no está expuesta ahí) con un valor generado
--   con un generador criptográfico (ej. `openssl rand -base64 32`), guardado ÚNICAMENTE en
--   el gestor de secretos de CI/CD (EAS Secrets / GitHub Actions) -- nunca en un archivo
--   del repo. Este paso queda pendiente de ejecución manual cuando se creen los proyectos
--   `cuidamos-staging`/`cuidamos-prod` (ver README > Entornos) -- no se puede scriptear
--   desde acá. Dejar constancia en NOTES del agente que implemente F2 (primera feature que
--   de verdad escribe datos cifrados) de que este paso debe verificarse ANTES de habilitar
--   la beta.
--
-- ============================================================================
-- 5) ROTACIÓN DE CLAVES
-- ============================================================================
--
-- Dos estrategias documentadas; cuál usar depende de cuánto dato cifrado ya exista y de
-- si el equipo puede tolerar una ventana de mantenimiento:
--
-- ESTRATEGIA A -- ventana de mantenimiento (recomendada mientras haya poco dato, MVP/beta
-- cerrada chica):
--   1. Poner la app en modo mantenimiento (o aceptar downtime breve).
--   2. Para cada columna cifrada: `update tabla set columna = extensions.encrypt_text(
--      extensions.decrypt_text(columna) )` -- pero usando la clave VIEJA para descifrar y
--      la NUEVA para cifrar en el mismo statement (ej. dos funciones temporales o pasar
--      ambas claves como parámetros explícitos en vez de depender de la GUC única durante
--      la migración de rotación).
--   3. Actualizar la GUC `app.settings.encryption_key` en los 3 entornos al nuevo valor
--      (repitiendo el setup de la sección 2 para ese entorno).
--   4. Levantar el modo mantenimiento.
--   Simple y suficiente mientras el volumen de datos y el downtime tolerado lo permitan.
--
-- ESTRATEGIA B -- doble clave transitoria (para cuando la Estrategia A ya no sea viable,
-- probablemente para cuando F4/F5 tengan volumen real en prod-cerrado):
--   1. Cada columna cifrada se acompaña de una columna `key_version smallint not null
--      default 1` (se agrega directamente en la migración que CREA esa columna cifrada en
--      F2/F4/F5, no acá).
--   2. Durante una rotación, ambas claves (vieja y nueva) están disponibles server-side a
--      la vez (ej. dos GUCs `app.settings.encryption_key_v1`/`_v2`, o una tabla interna no
--      expuesta por RLS con las claves por versión).
--   3. Todo INSERT/UPDATE nuevo cifra con la clave más nueva y escribe su `key_version`.
--   4. Un job en background (fuera del alcance de esta issue) re-cifra en lotes las filas
--      viejas: lee con la clave de su `key_version`, re-escribe con la clave nueva y
--      `key_version` actualizado, hasta que ninguna fila quede en la versión vieja.
--   5. Recién ahí se puede dar de baja la clave vieja.
--   No se implementa acá (YAGNI -- no hay todavía ninguna tabla con datos reales que
--   rotar); se deja documentado para que F4/F5 no se sorprendan cuando llegue el momento.
--
-- ============================================================================
-- 6) FUNCIONES HELPER
-- ============================================================================
--
-- `extensions.encrypt_text(text) returns bytea` / `extensions.decrypt_text(bytea) returns
-- text`: son las ÚNICAS funciones que F2/F4/F5 deben usar para leer/escribir columnas de
-- salud. Nunca usar `pgp_sym_encrypt`/`pgp_sym_decrypt` directo en otra migración -- así el
-- algoritmo/clave quedan centralizados acá y una futura rotación (Estrategia B) solo toca
-- este archivo (o uno nuevo que lo reemplace) en vez de cada tabla.
--
-- ============================================================================
-- 7) PoC (`_encryption_poc`)
-- ============================================================================
--
-- Tabla de prueba con RLS dueño-only para validar el ciclo completo insert → select con
-- descifrado automático, sin depender de ninguna tabla de dominio real (F2/F4/F5 todavía
-- no existen). Ver supabase/tests/encryption.test.sql para el smoke test versionado.

-- ----------------------------------------------------------------------------
-- CAMPOS DE SALUD A CIFRAR (lista canónica de referencia para F2/F4/F5)
-- ----------------------------------------------------------------------------
-- Esta NO es una lista de tablas creadas en esta migración -- F2/F4/F5 crean esas tablas
-- en sus propias issues, cuando corresponda. Esta es la lista de referencia que esas
-- issues DEBEN seguir: toda columna listada acá se define como `bytea` y se
-- escribe/lee EXCLUSIVAMENTE a través de `extensions.encrypt_text(text)` /
-- `extensions.decrypt_text(bytea)` -- nunca como texto plano en disco.
--
-- Si en el futuro aparece un campo de salud nuevo que no está en esta lista, hay que
-- agregarlo acá (en una migración que actualice este comentario, o el archivo que lo
-- reemplace) ANTES de crear la columna sin cifrar por error.
--
--   * cared_persons.condition_notes           -- F2, PGM-21 y sucesoras
--   * medications.name                        -- F4
--   * medications.dose                        -- F4
--   * medications.instructions                -- F4
--   * medication_logs.note                    -- F4
--   * shift_handovers.* (todos los campos de texto libre de esa tabla: resumen del
--     cambio de turno, observaciones abiertas sobre la persona cuidada, o cualquier otro
--     campo de texto libre que F5 termine definiendo en esa tabla) -- F5

-- ----------------------------------------------------------------------------
-- Funciones helper
-- ----------------------------------------------------------------------------

create or replace function extensions.current_encryption_key()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.settings.encryption_key', true), '')
$$;

comment on function extensions.current_encryption_key() is
  'PGM-3: lee la clave simétrica de cifrado desde la GUC app.settings.encryption_key '
  '(nunca hardcodeada -- ver sección 2 de esta migración para cómo se setea por entorno). '
  'Devuelve NULL si no está seteada; encrypt_text/decrypt_text son quienes deciden qué '
  'hacer con eso (fallar rápido, nunca cifrar/descifrar en silencio con una clave vacía). '
  'No se expone a `public`: solo la ejecutan las funciones security definer de esta '
  'migración, para que ningún rol de aplicación (authenticated/service_role) pueda leer '
  'la clave cruda directamente con `select current_setting(...)`.';

revoke all on function extensions.current_encryption_key() from public;

create or replace function extensions.encrypt_text(p_plain text)
returns bytea
language plpgsql
security definer
set search_path = extensions, pg_temp
as $$
declare
  v_key text;
begin
  if p_plain is null then
    return null;
  end if;

  v_key := extensions.current_encryption_key();
  if v_key is null then
    raise exception
      'app.settings.encryption_key no está configurada -- no se puede cifrar. Ver sección '
      '2 (SETUP DE LA CLAVE POR ENTORNO) en supabase/migrations/20260913210000_encryption_helpers.sql.';
  end if;

  return pgp_sym_encrypt(p_plain, v_key, 'cipher-algo=aes256');
end;
$$;

comment on function extensions.encrypt_text(text) is
  'PGM-3: cifra un texto plano con AES-256 (pgcrypto pgp_sym_encrypt) usando la clave de '
  'extensions.current_encryption_key(). NULL-safe: encrypt_text(null) = null. Cada llamada '
  'genera un ciphertext distinto para el mismo texto de entrada (pgp_sym_encrypt incluye '
  'salt/IV aleatorio) -- no usar esta columna para comparar igualdad de valores cifrados '
  'ni para búsquedas exactas sobre el ciphertext.';

create or replace function extensions.decrypt_text(p_cipher bytea)
returns text
language plpgsql
security definer
set search_path = extensions, pg_temp
as $$
declare
  v_key text;
begin
  if p_cipher is null then
    return null;
  end if;

  v_key := extensions.current_encryption_key();
  if v_key is null then
    raise exception
      'app.settings.encryption_key no está configurada -- no se puede descifrar. Ver '
      'sección 2 (SETUP DE LA CLAVE POR ENTORNO) en supabase/migrations/20260913210000_encryption_helpers.sql.';
  end if;

  return pgp_sym_decrypt(p_cipher, v_key);
end;
$$;

comment on function extensions.decrypt_text(bytea) is
  'PGM-3: descifra un valor generado por extensions.encrypt_text(text). NULL-safe: '
  'decrypt_text(null) = null. Lanza una excepción si la clave configurada no es la que se '
  'usó para cifrar -- ver sección 5 (ROTACIÓN DE CLAVES) para el procedimiento que evita '
  'este escenario al cambiar de clave.';

revoke all on function extensions.encrypt_text(text) from public;
revoke all on function extensions.decrypt_text(bytea) from public;
grant execute on function extensions.encrypt_text(text) to authenticated, service_role;
grant execute on function extensions.decrypt_text(bytea) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- PoC: tabla de prueba con RLS dueño-only
-- ----------------------------------------------------------------------------

create table _encryption_poc (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  secret_cipher bytea not null,
  created_at timestamptz not null default now()
);

comment on table _encryption_poc is
  'PGM-3: tabla de PoC para probar el ciclo completo de cifrado en reposo con pgcrypto '
  '(insert cifrando con extensions.encrypt_text, select descifrando con '
  'extensions.decrypt_text). NO es una tabla de dominio real -- no usar para features de '
  'negocio. Se mantiene mientras sirva de referencia ejecutable para F2/F4/F5; se puede '
  'borrar en una migración futura si se decide dejar de usarla como PoC.';

comment on column _encryption_poc.secret_cipher is
  'Valor cifrado (bytea) -- se escribe con extensions.encrypt_text(text) y se lee con '
  'extensions.decrypt_text(bytea). Nunca se guarda el texto plano en ninguna columna.';

alter table _encryption_poc enable row level security;

create policy encryption_poc_select_own
  on _encryption_poc for select
  using (owner_id = auth.uid());

create policy encryption_poc_insert_own
  on _encryption_poc for insert
  with check (owner_id = auth.uid());

create policy encryption_poc_delete_own
  on _encryption_poc for delete
  using (owner_id = auth.uid());

-- No hay policy de UPDATE (no hay caso de uso en esta PoC) -- sin policy, RLS deniega
-- todo UPDATE por defecto, igual que en family_members/families (PGM-15).
