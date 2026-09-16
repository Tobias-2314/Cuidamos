-- PGM-backend: cierra el TODO dejado por PGM-36/PGM-37 en
-- src/features/shifts/shiftHandoversService.ts -- `create_shift_handover` y
-- `get_latest_shift_handover_for_family` todavía no existían, documentado en
-- supabase/migrations/20260914160000_shift_handovers.sql.
--
-- Mismo criterio ya usado en medications (PGM-30 modelo -> PGM-32/33 RPCs):
-- `shift_handovers` tiene sus 4 columnas de contenido cifradas (bytea), así que un
-- `.insert()`/`.select()` directo de supabase-js no puede invocar
-- `extensions.encrypt_text`/`decrypt_text` -- hacen falta estas dos RPCs.
--
-- `security invoker` en ambas -- ninguna necesita bypasear RLS: `shift_handovers` ya
-- permite a cualquier miembro de la familia del turno insertar/leer (ver
-- shift_handovers_insert_member/select_member en 20260914160000_shift_handovers.sql),
-- mismo criterio que create_medication/get_medications_for_family (PGM-31/32).

-- ============================================================================
-- create_shift_handover(): escribe el traspaso de un turno, cifrando server-side
-- ============================================================================
-- Shape de parámetros y de retorno EXACTO al que ya espera
-- shiftHandoversService.createShiftHandover() (ver shiftHandoverRowSchema en ese
-- archivo) -- no se inventa nada nuevo del lado del contrato Frontend/Backend, esta
-- RPC solo llena el hueco que ya estaba documentado ahí.
--
-- Los 4 campos son nullable (un traspaso puede completar solo algunos, ver
-- shiftHandoverValidation.ts: "al menos uno no vacío" ya se valida en el Frontend antes
-- de llamar). `extensions.encrypt_text(null)` es NULL-safe (devuelve null), así que no
-- hace falta un `case when` por campo.
--
-- Devuelve los valores en texto plano tal como se recibieron (mismo criterio que
-- create_medication, PGM-31): evita un round-trip extra de decrypt_text ya que la RPC
-- los tiene en texto plano en el momento del insert.
create or replace function public.create_shift_handover(
  p_shift_id uuid,
  p_resumen text default null,
  p_comida text default null,
  p_animo text default null,
  p_pendientes text default null
)
returns table (
  id uuid,
  shift_id uuid,
  resumen text,
  comida text,
  animo text,
  pendientes text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  return query
  insert into shift_handovers (shift_id, resumen, comida, animo, pendientes, created_by)
  values (
    p_shift_id,
    extensions.encrypt_text(p_resumen),
    extensions.encrypt_text(p_comida),
    extensions.encrypt_text(p_animo),
    extensions.encrypt_text(p_pendientes),
    auth.uid()
  )
  returning
    shift_handovers.id,
    shift_handovers.shift_id,
    p_resumen,
    p_comida,
    p_animo,
    p_pendientes,
    shift_handovers.created_by,
    shift_handovers.created_at;
end;
$$;

comment on function public.create_shift_handover(uuid, text, text, text, text) is
  'PGM-36/backend: registra el traspaso de cierre de un turno, cifrando '
  'resumen/comida/animo/pendientes server-side. `created_by` SIEMPRE auth.uid(). '
  '`security invoker`: el INSERT sigue sujeto a shift_handovers_insert_member -- un '
  'shift_id de una familia ajena se rechaza con insufficient_privilege, esta función no '
  'amplía permisos. `shift_id` es UNIQUE (relación 1:1 con shifts, ver '
  '20260914160000_shift_handovers.sql) -- una segunda llamada para el mismo turno falla '
  'con unique_violation, no hace upsert (corregir un traspaso ya creado es un caso '
  'distinto, no cubierto por esta RPC).';

revoke all on function public.create_shift_handover(uuid, text, text, text, text) from public;
grant execute on function public.create_shift_handover(uuid, text, text, text, text) to authenticated;

-- ============================================================================
-- get_latest_shift_handover_for_family(): lee el traspaso más reciente de la familia
-- ============================================================================
-- Shape de retorno EXACTO al que ya espera getLatestShiftHandoverForFamily() (ver
-- latestShiftHandoverRowSchema en shiftHandoversService.ts) -- incluye
-- shift_starts_at/shift_ends_at resueltos vía join a shifts (la RPC resuelve el join,
-- mismo criterio que medication_name en get_medication_logs_for_family, PGM-33).
--
-- `security invoker`, `stable`: NO evita RLS -- el filtro `s.family_id = p_family_id`
-- es conveniencia de query, cada fila igual tiene que pasar
-- shift_handovers_select_member (PGM-35) para que el usuario la vea. Pasar el
-- family_id de una familia ajena simplemente devuelve 0 filas.
--
-- `order by sh.created_at desc limit 1`: "el" traspaso más reciente entre TODOS los
-- turnos de la familia (no por turno individual) -- así lo pide PGM-37: "el último
-- traspaso queda visible al abrir la app", un único traspaso reciente, no una lista.
create or replace function public.get_latest_shift_handover_for_family(p_family_id uuid)
returns table (
  id uuid,
  shift_id uuid,
  shift_starts_at timestamptz,
  shift_ends_at timestamptz,
  resumen text,
  comida text,
  animo text,
  pendientes text,
  created_by uuid,
  created_at timestamptz
)
language sql
security invoker
stable
set search_path = public, extensions, pg_temp
as $$
  select
    sh.id,
    sh.shift_id,
    s.starts_at,
    s.ends_at,
    extensions.decrypt_text(sh.resumen),
    extensions.decrypt_text(sh.comida),
    extensions.decrypt_text(sh.animo),
    extensions.decrypt_text(sh.pendientes),
    sh.created_by,
    sh.created_at
  from shift_handovers sh
  join shifts s on s.id = sh.shift_id
  where s.family_id = p_family_id
  order by sh.created_at desc
  limit 1;
$$;

comment on function public.get_latest_shift_handover_for_family(uuid) is
  'PGM-37/backend: trae el traspaso de turno más reciente de una familia (0 o 1 fila), '
  'ya descifrado, con el rango horario del turno resuelto vía join. `security invoker`: '
  'NO evita RLS, cada fila sigue sujeta a shift_handovers_select_member (PGM-35). '
  'Visible a TODA la familia, no solo a quien cerró el turno -- ese es el objetivo de '
  'PGM-37 ("visible al abrir la app para el siguiente cuidador").';

revoke all on function public.get_latest_shift_handover_for_family(uuid) from public;
grant execute on function public.get_latest_shift_handover_for_family(uuid) to authenticated;
