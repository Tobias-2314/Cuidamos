-- PGM-2: Setup proyecto Supabase + entornos
-- Migración base: habilita las extensiones que va a necesitar el resto del backlog.
--
-- pgcrypto: requerido para cifrar en reposo los campos de salud de la persona cuidada
--           (condición médica, notas de medicación, etc.) — no negociable por RGPD art. 9.
--           Se usa en migraciones futuras (F2, F4) para columnas tipo `bytea` cifradas con
--           pgp_sym_encrypt/pgp_sym_decrypt, y para generar UUIDs con gen_random_uuid().
-- uuid-ossp: alternativa/compat para generación de UUIDs en versiones de Postgres donde
--           gen_random_uuid() no está disponible en core.
--
-- Nota: en Supabase, las extensiones deben crearse en el schema `extensions`, no en `public`,
-- para no exponerlas vía la Data API.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
