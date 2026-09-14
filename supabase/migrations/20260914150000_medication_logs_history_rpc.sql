-- PGM-33: RPC de lectura del historial de tomas de medicación, visible por toda la familia.
--
-- BLOQUEANTE TÉCNICO (mismo caso que get_medications_for_family, ver
-- 20260913241500_medications_rpc.sql): `medication_logs.note` es `bytea` cifrado
-- (PGM-30) -- un `.select()` directo de supabase-js no puede invocar
-- `extensions.decrypt_text` sobre esa columna. `create_medication_log` (PGM-32, misma
-- migración anterior) ya resuelve la ESCRITURA de una toma, pero solo devuelve la fila
-- recién insertada -- no existe ninguna forma de traer el historial completo ya
-- descifrado. Esta RPC cubre esa lectura faltante.
--
-- GRANULARIDAD ELEGIDA: por FAMILIA (`p_family_id uuid`), no por medicamento
-- individual -- el punto central de la issue es "visible por todos los cuidadores",
-- es decir, un historial cronológico único que cualquier miembro de la familia puede
-- revisar sin tener que entrar medicamento por medicamento. Se agrega
-- `medication_name` (también descifrado acá) al resultado porque, a diferencia de
-- `MedicationsScreen` (donde cada fila ya está en el contexto de "este medicamento"),
-- un historial que mezcla tomas de varios medicamentos sin decir cuál fue cada una no
-- es legible -- mostrar el nombre es necesario para que la fila tenga sentido, no un
-- alcance nuevo.
--
-- `security invoker`, `set search_path = public, extensions, pg_temp`: mismo criterio
-- defensivo que el resto de las RPC de PGM-32 -- no amplía ni evita RLS, solo envuelve
-- decrypt_text alrededor de un select que de otra forma sería idéntico a lo que ya
-- permite medication_logs_select_member (PGM-30).
--
-- Orden `taken_at desc`: historial, más reciente primero (a diferencia de
-- get_medications_for_family, que lista medicamentos por created_at asc -- acá el caso
-- de uso es "qué pasó últimamente", no "en qué orden se cargaron").

create or replace function public.get_medication_logs_for_family(p_family_id uuid)
returns table (
  id uuid,
  medication_id uuid,
  medication_name text,
  taken_by uuid,
  taken_at timestamptz,
  note text,
  created_at timestamptz
)
language sql
security invoker
stable
set search_path = public, extensions, pg_temp
as $$
  select
    ml.id,
    ml.medication_id,
    extensions.decrypt_text(m.name),
    ml.taken_by,
    ml.taken_at,
    extensions.decrypt_text(ml.note),
    ml.created_at
  from medication_logs ml
  join medications m on m.id = ml.medication_id
  join cared_persons cp on cp.id = m.cared_person_id
  where cp.family_id = p_family_id
  order by ml.taken_at desc;
$$;

comment on function public.get_medication_logs_for_family(uuid) is
  'PGM-33: historial de tomas de medicación de una familia, ordenado por taken_at desc '
  '(más reciente primero), con medication_name/note ya descifrados. `security invoker`: '
  'NO evita RLS -- el filtro `cp.family_id = p_family_id` es solo una conveniencia de '
  'query, cada fila igual tiene que pasar medication_logs_select_member (PGM-30) para '
  'que el usuario la vea. Pasar el family_id de una familia ajena simplemente devuelve '
  '0 filas. A propósito NO filtra por taken_by: el objetivo de la issue es que el '
  'historial sea visible por TODOS los cuidadores de la familia, no solo quien registró '
  'cada toma.';

revoke all on function public.get_medication_logs_for_family(uuid) from public;
grant execute on function public.get_medication_logs_for_family(uuid) to authenticated;
