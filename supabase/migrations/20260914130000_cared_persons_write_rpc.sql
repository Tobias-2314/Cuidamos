-- PGM-22: RPC de escritura para exponer el alta del perfil de la persona cuidada
-- (cared_persons) al cliente JS: `create_cared_person`.
--
-- MISMO BLOQUEANTE TÉCNICO que 20260913243000_medications_write_rpc.sql (PGM-31) y
-- 20260913241500_medications_rpc.sql (PGM-32): PostgREST no puede invocar
-- `extensions.encrypt_text(text)` dentro de un `.insert()` normal de supabase-js -- solo
-- traduce ese verbo a columnas/filtros reales de la tabla, no a llamadas arbitrarias a
-- funciones con un argumento `bytea` suelto. `cared_persons.condition_notes` es un campo de
-- salud cifrado (ver 20260913220000_cared_persons.sql / lista canónica de PGM-3), así que un
-- `.insert()` directo de supabase-js no puede completarlo -- de ahí esta RPC.
--
-- Mismo criterio que create_medication (PGM-31):
--   * `security invoker` (NO `security definer`) -- esta función no amplía ni evita ningún
--     permiso, sigue sujeta a `cared_persons_insert_member` (PGM-21,
--     20260913220000_cared_persons.sql). Un `p_family_id` de una familia de la que el
--     usuario no es miembro se rechaza con `insufficient_privilege`, exactamente igual que
--     un `.insert()` directo de supabase-js.
--   * `set search_path = public, extensions, pg_temp` -- mismo criterio defensivo que el
--     resto de las funciones de este proyecto (evita hijacking de search_path).
--   * Devuelve la fila resultante con `condition_notes` ya en texto plano (el mismo valor
--     recibido como parámetro, sin round-trip de decrypt_text) para que el cliente no tenga
--     que hacer una lectura extra tras el alta.
--
-- CONSENTIMIENTO EXPLÍCITO (RGPD art. 9, PGM-24): `consent_given_at` NO es un parámetro de
-- esta función -- el cliente NUNCA manda ese timestamp. La función lo fija internamente con
-- `now()` en el momento exacto del INSERT, garantizando que el valor es real (nunca
-- retroactivo ni arbitrario). La UI (`CaredPersonFormScreen`, PGM-22) solo puede invocar esta
-- RPC después de que el usuario tildó el checkbox de consentimiento explícito -- la garantía
-- de que el timestamp existe y es genuino vive acá, a nivel de datos, no confiamos
-- únicamente en la UI.
--
-- VALIDACIÓN DE full_name: se replica acá el mismo criterio de "falla rápido" que
-- `create_medication`/`medicationsService.createMedication` -- el cliente (`caredPersonsService.
-- createCaredPerson`) ya valida `full_name` no vacío ANTES de llamar a esta RPC (evita un
-- round-trip de red para un error que ya sabemos que va a pasar). Esta función agrega ADEMÁS
-- una validación explícita server-side (además del `check (char_length(trim(full_name)) > 0)`
-- que ya existe en la tabla desde PGM-21): así, si algún día se invoca la RPC directamente
-- (ej. desde otro cliente, un test, o un bug en la validación de la app), el error es
-- explícito (`invalid_parameter_value` con mensaje claro) en vez de depender únicamente del
-- mensaje genérico del check constraint de la tabla.

create or replace function public.create_cared_person(
  p_family_id uuid,
  p_full_name text,
  p_birth_date date default null,
  p_condition_notes text default null
)
returns table (
  id uuid,
  family_id uuid,
  full_name text,
  birth_date date,
  condition_notes text,
  consent_given_at timestamptz,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  if p_full_name is null or char_length(trim(p_full_name)) = 0 then
    raise exception 'full_name no puede estar vacío' using errcode = '22023'; -- invalid_parameter_value
  end if;

  return query
  insert into cared_persons (
    family_id,
    full_name,
    birth_date,
    condition_notes,
    consent_given_at,
    created_by
  )
  values (
    p_family_id,
    p_full_name,
    p_birth_date,
    extensions.encrypt_text(p_condition_notes),
    now(),
    auth.uid()
  )
  returning
    cared_persons.id,
    cared_persons.family_id,
    cared_persons.full_name,
    cared_persons.birth_date,
    p_condition_notes,
    cared_persons.consent_given_at,
    cared_persons.created_by,
    cared_persons.created_at;
end;
$$;

comment on function public.create_cared_person(uuid, text, date, text) is
  'PGM-22: da de alta el perfil de la persona cuidada, cifrando condition_notes '
  'server-side y fijando consent_given_at = now() internamente (el cliente nunca manda ese '
  'timestamp -- garantiza consentimiento explícito real, no retroactivo, RGPD art. 9). '
  '`created_by` es SIEMPRE auth.uid(). `security invoker`: el INSERT sigue sujeto a '
  'cared_persons_insert_member (PGM-21) -- un family_id de una familia ajena se rechaza con '
  'insufficient_privilege, esta función no amplía permisos. Devuelve la fila con '
  'condition_notes en texto plano tal como se recibió (evita un round-trip extra de '
  'decrypt_text), igual que create_medication.';

revoke all on function public.create_cared_person(uuid, text, date, text) from public;
grant execute on function public.create_cared_person(uuid, text, date, text) to authenticated;
