-- PGM-31: RPCs de escritura para exponer el alta/edición de medications (cifrados) al
-- cliente JS: `create_medication` / `update_medication`.
--
-- MISMO BLOQUEANTE TÉCNICO que 20260913241500_medications_rpc.sql (PGM-32): PostgREST no
-- puede invocar `extensions.encrypt_text(text)` dentro de un `.insert()`/`.update()` normal
-- de supabase-js -- solo traduce esos verbos a columnas/filtros reales de la tabla, no a
-- llamadas arbitrarias a funciones con un argumento `bytea` suelto. `medicationsService.ts`
-- (`createMedication`/`updateMedication`, PGM-31) ya invoca estas dos RPC vía
-- `supabase.rpc(...)` -- sin esta migración esas funciones fallan en runtime con
-- "function public.create_medication(...) does not exist".
--
-- Mismo criterio que `get_medications_for_family`/`create_medication_log` (PGM-32):
--   * `security invoker` (NO `security definer`) -- estas funciones no amplían ni evitan
--     ningún permiso, siguen sujetas a `medications_insert_member`/`medications_update_member`
--     (PGM-30, 20260913240000_medications.sql). Pasar un `cared_person_id`/`medication_id`
--     de otra familia se rechaza (insert) o afecta 0 filas (update) exactamente igual que un
--     `.insert()`/`.update()` directo de supabase-js -- esta RPC solo envuelve
--     encrypt_text(text) alrededor de un insert/update que de otra forma sería idéntico.
--   * `set search_path = public, extensions, pg_temp` -- mismo criterio defensivo que el
--     resto de las funciones de este proyecto (evita hijacking de search_path), buena
--     práctica recomendada por el linter de Supabase aunque acá sea `security invoker`.
--   * Devuelven la fila resultante ya descifrada (mismo shape que
--     `get_medications_for_family`) para que el cliente no tenga que hacer un round-trip
--     extra de lectura tras escribir.

create or replace function public.create_medication(
  p_cared_person_id uuid,
  p_name text,
  p_dose text,
  p_instructions text default null,
  p_schedule text default null
)
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
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  return query
  insert into medications (cared_person_id, name, dose, instructions, schedule, created_by)
  values (
    p_cared_person_id,
    extensions.encrypt_text(p_name),
    extensions.encrypt_text(p_dose),
    extensions.encrypt_text(p_instructions),
    p_schedule,
    auth.uid()
  )
  returning
    medications.id,
    medications.cared_person_id,
    p_name,
    p_dose,
    p_instructions,
    medications.schedule,
    medications.created_by,
    medications.created_at;
end;
$$;

comment on function public.create_medication(uuid, text, text, text, text) is
  'PGM-31: da de alta un medicamento, cifrando name/dose/instructions server-side. '
  '`created_by` es SIEMPRE auth.uid() -- quien da de alta el medicamento, igual que '
  '`created_by` en shifts/cared_persons. `security invoker`: el INSERT sigue sujeto a '
  'medications_insert_member (PGM-30) -- un cared_person_id de una familia ajena se '
  'rechaza con insufficient_privilege, esta función no amplía permisos. Devuelve la fila '
  'en texto plano tal como se recibió (evita un round-trip extra de decrypt_text) para que '
  'la UI pueda confirmar el alta sin volver a consultar.';

revoke all on function public.create_medication(uuid, text, text, text, text) from public;
grant execute on function public.create_medication(uuid, text, text, text, text) to authenticated;

create or replace function public.update_medication(
  p_medication_id uuid,
  p_name text default null,
  p_dose text default null,
  p_instructions text default null,
  p_clear_instructions boolean default false,
  p_schedule text default null,
  p_clear_schedule boolean default false
)
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
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  -- Contrato con medicationsService.ts (updateMedication): `p_name`/`p_dose` NULL
  -- significa "no tocar" (name/dose son NOT NULL, nunca se piden vaciar). Para los campos
  -- nullable (instructions/schedule) el caller manda un flag `p_clear_*` explícito para
  -- distinguir "no tocar" de "borrar el valor existente" -- un `p_instructions` NULL por sí
  -- solo es ambiguo entre esos dos casos, por eso no alcanza con coalesce().
  return query
  update medications
  set
    name = case when p_name is not null then extensions.encrypt_text(p_name) else medications.name end,
    dose = case when p_dose is not null then extensions.encrypt_text(p_dose) else medications.dose end,
    instructions = case
      when p_clear_instructions then null
      when p_instructions is not null then extensions.encrypt_text(p_instructions)
      else medications.instructions
    end,
    schedule = case
      when p_clear_schedule then null
      when p_schedule is not null then p_schedule
      else medications.schedule
    end
  where medications.id = p_medication_id
  returning
    medications.id,
    medications.cared_person_id,
    extensions.decrypt_text(medications.name),
    extensions.decrypt_text(medications.dose),
    extensions.decrypt_text(medications.instructions),
    medications.schedule,
    medications.created_by,
    medications.created_at;
end;
$$;

comment on function public.update_medication(uuid, text, text, text, boolean, text, boolean) is
  'PGM-31: edita un medicamento existente, cifrando server-side los campos que cambian. '
  '`security invoker`: el UPDATE sigue sujeto a medications_update_member (PGM-30) -- si el '
  'medicamento no es de la familia del usuario, el UPDATE afecta 0 filas (RLS silenciosa en '
  'UPDATE, no excepción) y esta función devuelve un result set vacío, igual que un '
  '`.update()` directo de supabase-js -- medicationsService.ts lo mapea a un error '
  '`not_found`. Devuelve la fila ya descifrada (a diferencia de create_medication, acá SÍ '
  'hace falta un decrypt_text explícito porque los campos no tocados conservan su valor '
  'cifrado existente, que el caller no tiene en texto plano).';

revoke all on function public.update_medication(uuid, text, text, text, boolean, text, boolean) from public;
grant execute on function public.update_medication(uuid, text, text, text, boolean, text, boolean) to authenticated;
