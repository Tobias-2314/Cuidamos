-- PGM-32: RPCs mínimas para exponer medications/medication_logs (cifrados) al cliente JS.
--
-- BLOQUEANTE TÉCNICO REAL (ver NOTES del agente Frontend que implementó esta issue):
-- `extensions.encrypt_text(text)` / `extensions.decrypt_text(bytea)` (PGM-3,
-- 20260913210000_encryption_helpers.sql) son funciones de Postgres, pero supabase-js NO
-- puede invocarlas dentro de un `.select()`/`.insert()` normal de PostgREST -- PostgREST solo
-- traduce esos verbos a columnas/filtros reales de la tabla, no a llamadas arbitrarias a
-- funciones con un argumento `bytea` suelto. Sin alguna RPC intermedia, el cliente JS de
-- PGM-32 ("Marcar toma como completada") no tiene ninguna forma de leer `medications.name`/
-- `dose` ni de escribir `medication_logs.note` como texto plano -- la feature no puede
-- funcionar en absoluto.
--
-- Se eligió la opción (a) del enunciado de la issue: dos funciones RPC delgadas,
-- `security invoker` (NO `security definer`) para que seguir dependiendo de las policies de
-- RLS ya probadas en supabase/tests/medications.test.sql (PGM-30) -- estas funciones no
-- amplían ni evitan ningún permiso, solo envuelven encrypt_text/decrypt_text alrededor de un
-- select/insert que de otra forma sería idéntico a lo que ya hace la app. Se descartó la
-- opción (b) (vista auxiliar) porque el INSERT de medication_logs necesita cifrar `note` en
-- el momento de escribir, y una vista no resuelve eso sin un trigger `instead of` -- una RPC
-- plpgsql es más simple y explícita para ese caso.
--
-- `set search_path = public, extensions, pg_temp`: mismo criterio defensivo que las
-- funciones `security definer` de PGM-3 (evita hijacking de search_path), aunque acá sea
-- `security invoker` -- buena práctica recomendada por el linter de Supabase igual.

create or replace function public.get_medications_for_family(p_family_id uuid)
returns table (
  id uuid,
  cared_person_id uuid,
  name text,
  dose text,
  instructions text,
  schedule text,
  created_by uuid,
  created_at timestamptz
)
language sql
security invoker
stable
set search_path = public, extensions, pg_temp
as $$
  select
    m.id,
    m.cared_person_id,
    extensions.decrypt_text(m.name),
    extensions.decrypt_text(m.dose),
    extensions.decrypt_text(m.instructions),
    m.schedule,
    m.created_by,
    m.created_at
  from medications m
  join cared_persons cp on cp.id = m.cared_person_id
  where cp.family_id = p_family_id
  order by m.created_at asc;
$$;

comment on function public.get_medications_for_family(uuid) is
  'PGM-32: lista los medicamentos de una familia con name/dose/instructions ya '
  'descifrados. `security invoker`: NO evita RLS -- el filtro `cp.family_id = p_family_id` '
  'es solo una conveniencia de query, la fila igual tiene que pasar '
  'medications_select_member/cared_persons_select_member (PGM-21/PGM-30) para que el '
  'usuario la vea. Pasar el family_id de una familia ajena simplemente devuelve 0 filas, '
  'nunca datos de otra familia.';

revoke all on function public.get_medications_for_family(uuid) from public;
grant execute on function public.get_medications_for_family(uuid) to authenticated;

create or replace function public.create_medication_log(
  p_medication_id uuid,
  p_taken_at timestamptz default now(),
  p_note text default null
)
returns table (
  id uuid,
  medication_id uuid,
  taken_by uuid,
  taken_at timestamptz,
  note text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  return query
  insert into medication_logs (medication_id, taken_by, taken_at, note)
  values (
    p_medication_id,
    auth.uid(),
    coalesce(p_taken_at, now()),
    extensions.encrypt_text(p_note)
  )
  returning
    medication_logs.id,
    medication_logs.medication_id,
    medication_logs.taken_by,
    medication_logs.taken_at,
    p_note,
    medication_logs.created_at;
end;
$$;

comment on function public.create_medication_log(uuid, timestamptz, text) is
  'PGM-32: registra una toma. `taken_by` es SIEMPRE auth.uid() -- quien toca el botón '
  '"Marcar como dado" marca que ÉL/ELLA dio la medicación (ver NOTES del agente Frontend: '
  'no hay UI para "en nombre de quién" registrar, eso agregaría fricción sin pedido '
  'explícito de producto). `security invoker`: el INSERT sigue sujeto a '
  'medication_logs_insert_member (PGM-30, incluye is_family_member()) -- esta función no '
  'amplía permisos, solo envuelve extensions.encrypt_text(text) para poder escribir `note` '
  'como texto plano desde el cliente. Devuelve `note` en texto plano tal como se recibió '
  '(evita un roundtrip extra de decrypt_text ya que el caller ya lo tiene) para que la UI '
  'confirme la toma sin tener que re-consultar.';

revoke all on function public.create_medication_log(uuid, timestamptz, text) from public;
grant execute on function public.create_medication_log(uuid, timestamptz, text) to authenticated;
