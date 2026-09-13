-- PGM-24: [BE] Consentimiento explícito al crear el perfil (checkbox + registro de
-- timestamp) -- enforcement a nivel de datos.
--
-- Contexto (gap señalado por el Tech Lead en la revisión de PGM-21,
-- 20260913220000_cared_persons.sql): esa migración agregó `cared_persons.consent_given_at
-- timestamptz` NULLABLE a propósito, dejando explícitamente el flujo de
-- validación/enforcement para esta issue. Cita del Tech Lead: "hoy se puede crear una
-- `cared_person` sin consentimiento y nada lo impide a nivel de datos". Esta migración
-- cierra ese gap.
--
-- Decisión: NOT NULL directo (en vez de un `check (consent_given_at is not null)`).
--   - Es la opción más simple y directa: expresa el invariante ("toda cared_person tiene
--     que tener un consentimiento registrado") en el catálogo de la columna en vez de en
--     un constraint aparte -- una persona leyendo el esquema lo ve inmediatamente en
--     `\d cared_persons` sin tener que buscar checks.
--   - No hace falta backfill: este proyecto todavía no tiene datos reales de familias (ver
--     README, sección de entornos) -- no hay filas existentes con `consent_given_at` NULL
--     que romper. Si ya hubiera datos reales, un `check` con backfill previo habría sido
--     más seguro para no bloquear un `ALTER COLUMN ... SET NOT NULL` sobre filas
--     existentes; no es el caso acá.
--   - El resultado observable para quien inserta sin el valor es el mismo en la práctica
--     que un check: Postgres rechaza el INSERT/UPDATE (acá con `not_null_violation` en vez
--     de `check_violation`) -- ver supabase/tests/cared_persons.test.sql, caso agregado en
--     esta issue.
--
-- IMPORTANTE -- de dónde sale el valor: esta migración SOLO garantiza que el timestamp no
-- puede faltar a nivel de base de datos. No captura el consentimiento en sí -- eso lo
-- setea la aplicación (Frontend) al momento en que el usuario tilda el checkbox de
-- consentimiento explícito y confirma la creación del perfil (ej. `consent_given_at =
-- now()` en ese momento, nunca un valor arbitrario o retroactivo). La UI/checkbox de
-- captura es una issue de Frontend separada -- ver NOTES del agente para el estado de esa
-- issue al momento de este cambio.
alter table cared_persons
  alter column consent_given_at set not null;

comment on column cared_persons.consent_given_at is
  'Timestamp del consentimiento explícito (RGPD art. 9) para tratar los datos de esta '
  'persona cuidada. NOT NULL desde PGM-24: es imposible persistir una cared_person sin '
  'consentimiento. El valor lo setea la aplicación (Frontend) en el momento en que el '
  'usuario tilda el checkbox de consentimiento y confirma -- el backend solo garantiza que '
  'no puede faltar, no captura el consentimiento en sí (eso es UX/Frontend). Columna '
  'agregada nullable en PGM-21, vuelta NOT NULL acá.';
