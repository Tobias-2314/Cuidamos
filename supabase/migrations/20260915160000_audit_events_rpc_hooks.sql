-- PGM-13: [T6] Audit log -- enganche manual en las RPCs RGPD (T4/T5 de la issue original:
-- export_family_data / delete_family_data, PGM-11/PGM-12 en este repo).
--
-- Completa el punto de enganche que esas dos migraciones ya dejaron documentado
-- ("PGM-13: enganchar acá el log de auditoría") sin poder implementarlo porque
-- `audit_events` todavía no existía:
--   * supabase/migrations/20260915130000_export_family_data_rpc.sql
--   * supabase/migrations/20260915140000_delete_family_data_rpc.sql
--
-- Esta migración NO edita esos dos archivos (son historial inmutable, ya aplicados) --
-- hace `create or replace function` sobre las mismas dos RPCs, mismo criterio que
-- 20260913241500_medications_rpc.sql -> 20260913243000_medications_write_rpc.sql.
--
-- ============================================================================
-- log_family_rpc_audit_event(): helper `security definer` acotado, NO un insert directo
-- ============================================================================
-- export_family_data es `security invoker` (decisión de diseño explícita de PGM-11: la RLS
-- de todas las tablas relevantes ya permite a cualquier miembro ver todas las filas de su
-- familia, así que no hace falta bypasear nada para LEER). Pero `audit_events` no tiene
-- policy de INSERT para `authenticated` a propósito (ver nota de diseño en
-- 20260915150000_audit_events.sql) -- un INSERT directo dentro de export_family_data
-- ejecutándose como `security invoker` fallaría por RLS.
--
-- La solución NO es convertir export_family_data entero a `security definer` (eso
-- ampliaría innecesariamente qué bypasea RLS en una función que hoy solo necesita bypass
-- para UNA escritura puntual, contradiciendo el criterio de "menor privilegio posible" que
-- esa migración documentó explícitamente). En su lugar, se agrega un helper `security
-- definer` de propósito único -- mismo patrón exacto que `is_family_member()` (PGM-25):
-- una función chica, acotada, que expone SOLO el permiso puntual que hace falta (loguear
-- un evento de auditoría para la familia de la que el caller ya demostró ser miembro), sin
-- exponer un bypass general de RLS sobre `audit_events` ni sobre ninguna otra tabla.
--
-- Por qué es seguro exponerla con `grant execute ... to authenticated` (necesario para que
-- export_family_data, corriendo como el usuario real, pueda invocarla):
--   1) IGNORA cualquier "actor" que un caller quisiera pasar -- no existe ese parámetro.
--      El actor SIEMPRE es `auth.uid()`, leído acá adentro, en el momento de la llamada.
--      Un usuario no puede hacer que esta función mienta sobre quién ejecutó la acción.
--   2) Valida membresía (`is_family_member`) ANTES de insertar -- un usuario no puede
--      loguear un evento para una familia ajena.
--   3) `p_action` está restringido por CHECK a los dos valores que esta issue necesita
--      (`export_family_data`/`delete_family_data`) -- un usuario no puede invocarla
--      directamente vía `.rpc()` para inyectar eventos falsos tipo `insert`/`update`/
--      `delete` (esos SOLO los generan los triggers de la migración anterior, nunca esta
--      función) ni para otra `entity` que no sea `'family'`.
-- Resultado: llamar a esta función directamente (sin pasar por export_family_data/
-- delete_family_data) en el peor caso solo permite a un usuario auto-registrar un evento
-- "exporté/borré mi propia familia" que en realidad no ejecutó -- ruido posible en su
-- propio log, nunca acceso a datos ajenos ni suplantación de otro actor. Riesgo aceptado y
-- documentado (ver NOTES del agente).
create or replace function public.log_family_rpc_audit_event(
  p_family_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
begin
  if p_action not in ('export_family_data', 'delete_family_data') then
    raise exception 'acción de auditoría no soportada: %', p_action using errcode = '22023';
  end if;

  if not is_family_member(p_family_id, auth.uid()) then
    raise exception 'No sos miembro de esta familia' using errcode = '42501';
  end if;

  insert into audit_events (actor_user_id, family_id, entity, entity_id, action, metadata)
  values (auth.uid(), p_family_id, 'family', p_family_id, p_action, '{}'::jsonb);
end;
$$;

comment on function public.log_family_rpc_audit_event(uuid, text) is
  'PGM-13: helper `security definer` de propósito único para loguear en audit_events un '
  'evento manual de las RPCs RGPD (export_family_data/delete_family_data). NO acepta un '
  '"actor" como parámetro -- siempre usa auth.uid(). Valida membresía y restringe '
  '`p_action` a los dos valores soportados antes de insertar. Ver nota de diseño extensa en '
  'esta migración sobre por qué existe como helper acotado en vez de convertir '
  'export_family_data entero a security definer, y sobre el riesgo aceptado de exponerla '
  'con grant a authenticated.';

revoke all on function public.log_family_rpc_audit_event(uuid, text) from public;
grant execute on function public.log_family_rpc_audit_event(uuid, text) to authenticated;

-- ============================================================================
-- export_family_data: agrega el log de auditoría en el punto ya documentado.
-- ============================================================================
-- Cuerpo idéntico al de 20260915130000_export_family_data_rpc.sql salvo:
--   * `volatile` en vez de `stable` -- ya no es una función de solo lectura (anticipado
--     explícitamente en el comentario original: "cuando se agregue ese insert en
--     audit_events, esta función deja de ser stable y pasa a volatile").
--   * `perform log_family_rpc_audit_event(p_family_id, 'export_family_data');` justo
--     después del chequeo de membresía, en el punto marcado "PGM-13: enganchar acá".
-- Se mantiene `security invoker` -- ver nota de diseño de log_family_rpc_audit_event()
-- arriba sobre por qué no hace falta ampliar el nivel de privilegio de esta función entera
-- solo para poder escribir un evento de auditoría.
create or replace function public.export_family_data(p_family_id uuid)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_family_id is null then
    raise exception 'p_family_id es obligatorio' using errcode = '22023'; -- invalid_parameter_value
  end if;

  -- Chequeo explícito de membresía (defense in depth + error legible) -- ver nota de diseño
  -- extensa en 20260915130000_export_family_data_rpc.sql sobre por qué no basta con dejar
  -- que las RLS de cada tabla devuelvan silenciosamente arrays vacíos.
  if not is_family_member(p_family_id, auth.uid()) then
    raise exception 'No sos miembro de esta familia' using errcode = '42501'; -- insufficient_privilege
  end if;

  -- PGM-13: enganche de auditoría. Vía log_family_rpc_audit_event() (security definer
  -- acotado, ver nota de diseño en esta migración) -- no un insert directo, porque
  -- audit_events no tiene policy de INSERT para authenticated y esta función sigue siendo
  -- security invoker.
  perform log_family_rpc_audit_event(p_family_id, 'export_family_data');

  select jsonb_build_object(
    'exported_at', now(),
    'exported_by', auth.uid(),
    'family_id', p_family_id,
    'family', (
      select jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'created_by', f.created_by,
        'created_at', f.created_at
      )
      from families f
      where f.id = p_family_id
    ),
    'members', (
      -- security definer reusado de PGM-27 -- ver nota de diseño en
      -- 20260915130000_export_family_data_rpc.sql.
      select coalesce(
        jsonb_agg(jsonb_build_object('user_id', lm.user_id, 'role', lm.role)),
        '[]'::jsonb
      )
      from list_family_members(p_family_id) lm
    ),
    'cared_persons', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', cp.id,
            'full_name', cp.full_name,
            'birth_date', cp.birth_date,
            -- Dato de salud (RGPD art. 9) -- descifrado acá porque el titular tiene derecho
            -- legal a leer sus propios datos en texto plano (ver docs/product-vision.md).
            'condition_notes', extensions.decrypt_text(cp.condition_notes),
            'consent_given_at', cp.consent_given_at,
            'created_by', cp.created_by,
            'created_at', cp.created_at,
            'medical_contacts', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', mc.id,
                    'full_name', mc.full_name,
                    'specialty', mc.specialty,
                    'phone', mc.phone,
                    'notes', mc.notes,
                    'created_by', mc.created_by,
                    'created_at', mc.created_at
                  )
                  order by mc.created_at asc
                ),
                '[]'::jsonb
              )
              from medical_contacts mc
              where mc.cared_person_id = cp.id
            ),
            'emergency_contacts', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', ec.id,
                    'full_name', ec.full_name,
                    'relationship', ec.relationship,
                    'phone', ec.phone,
                    'notes', ec.notes,
                    'created_by', ec.created_by,
                    'created_at', ec.created_at
                  )
                  order by ec.created_at asc
                ),
                '[]'::jsonb
              )
              from emergency_contacts ec
              where ec.cared_person_id = cp.id
            ),
            'medications', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', m.id,
                    -- Datos de salud (RGPD art. 9) -- descifrados, ver comentario de
                    -- condition_notes arriba.
                    'name', extensions.decrypt_text(m.name),
                    'dose', extensions.decrypt_text(m.dose),
                    'instructions', extensions.decrypt_text(m.instructions),
                    'schedule', m.schedule,
                    'created_by', m.created_by,
                    'created_at', m.created_at,
                    'medication_logs', (
                      select coalesce(
                        jsonb_agg(
                          jsonb_build_object(
                            'id', ml.id,
                            'taken_by', ml.taken_by,
                            'taken_at', ml.taken_at,
                            'note', extensions.decrypt_text(ml.note),
                            'created_at', ml.created_at
                          )
                          order by ml.taken_at desc
                        ),
                        '[]'::jsonb
                      )
                      from medication_logs ml
                      where ml.medication_id = m.id
                    )
                  )
                  order by m.created_at asc
                ),
                '[]'::jsonb
              )
              from medications m
              where m.cared_person_id = cp.id
            )
          )
          order by cp.created_at asc
        ),
        '[]'::jsonb
      )
      from cared_persons cp
      where cp.family_id = p_family_id
    ),
    'shifts', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'cared_person_id', s.cared_person_id,
            'assigned_to', s.assigned_to,
            'starts_at', s.starts_at,
            'ends_at', s.ends_at,
            'status', s.status,
            'created_by', s.created_by,
            'created_at', s.created_at,
            -- null si el turno todavía no tiene traspaso registrado (relación 1:1 opcional,
            -- ver shift_handovers.shift_id UNIQUE en 20260914160000_shift_handovers.sql).
            'handover', (
              select jsonb_build_object(
                'id', sh.id,
                -- Datos de salud/cuidado (RGPD art. 9) -- descifrados, ver comentario de
                -- condition_notes arriba. Los 4 campos de shift_handovers van cifrados.
                'resumen', extensions.decrypt_text(sh.resumen),
                'comida', extensions.decrypt_text(sh.comida),
                'animo', extensions.decrypt_text(sh.animo),
                'pendientes', extensions.decrypt_text(sh.pendientes),
                'created_by', sh.created_by,
                'created_at', sh.created_at
              )
              from shift_handovers sh
              where sh.shift_id = s.id
            )
          )
          order by s.starts_at desc
        ),
        '[]'::jsonb
      )
      from shifts s
      where s.family_id = p_family_id
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.export_family_data(uuid) is
  'PGM-11/PGM-13: export RGPD (art. 20) completo de los datos de la familia p_family_id -- '
  'familia, miembros, personas cuidadas (con condition_notes descifrado), doctores/'
  'contactos de emergencia, medicaciones (descifradas) con su historial de tomas anidado '
  '(descifrado), y turnos con su traspaso anidado si existe (descifrado). `security '
  'invoker`: NO amplía permisos -- cada subconsulta sigue sujeta a la RLS de su tabla '
  '(member-scoped en todas menos family_members, resuelta reusando list_family_members() '
  'de PGM-27). Devuelve insufficient_privilege si el caller no es miembro de p_family_id. '
  'Deja un registro en audit_events (action=''export_family_data'') vía '
  'log_family_rpc_audit_event() -- security definer acotado, ver nota de diseño en '
  '20260915160000_audit_events_rpc_hooks.sql. `volatile` (ya no `stable`) desde que escribe '
  'ese registro. NO incluye documentos (no existe bucket de Storage todavía) ni '
  'family_invitations/push_tokens (fuera del alcance de portabilidad de datos personales).';

revoke all on function public.export_family_data(uuid) from public;
grant execute on function public.export_family_data(uuid) to authenticated;

-- ============================================================================
-- delete_family_data: agrega el log de auditoría en el punto ya documentado.
-- ============================================================================
-- Cuerpo idéntico al de 20260915140000_delete_family_data_rpc.sql salvo la línea
-- `perform log_family_rpc_audit_event(...)` en el punto marcado "PGM-13: enganchar acá",
-- ANTES del `delete from families` -- mismo criterio ya documentado en esa migración
-- ("loguear el borrado ANTES de ejecutarlo, no después, para que quede registrado aunque
-- algo falle a mitad del cascade"). Esta función ya era `security definer`, así que
-- técnicamente podría hacer el insert directo a audit_events -- se usa igual
-- log_family_rpc_audit_event() por consistencia con export_family_data (un solo camino de
-- escritura para el log manual de RPCs, más fácil de auditar) y porque revalidar
-- membresía ahí adentro es una capa de defensa en profundidad gratuita, no un costo real.
create or replace function public.delete_family_data(
  p_family_id uuid,
  p_confirm boolean,
  p_family_name_confirmation text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_family_name text;
  v_counts jsonb;
  v_deleted_rows int;
begin
  if p_family_id is null then
    raise exception 'p_family_id es obligatorio' using errcode = '22023'; -- invalid_parameter_value
  end if;

  -- Chequeo de membresía PRIMERO -- ver nota de diseño en
  -- 20260915140000_delete_family_data_rpc.sql sobre por qué esto evita usar el resto de
  -- las validaciones (en particular el mensaje de "nombre no coincide") como oráculo para
  -- una familia ajena.
  if not is_family_member(p_family_id, auth.uid()) then
    raise exception 'No sos miembro de esta familia' using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Capa de confirmación 1/2.
  if p_confirm is distinct from true then
    raise exception
      'Borrado cancelado: p_confirm debe ser exactamente true para confirmar el borrado '
      'total e irreversible de la familia' using errcode = '22023';
  end if;

  select f.name into v_family_name
  from families f
  where f.id = p_family_id;

  if v_family_name is null then
    raise exception 'Familia no encontrada' using errcode = 'P0002'; -- no_data_found
  end if;

  -- Capa de confirmación 2/2 -- comparación exacta (case-sensitive).
  if p_family_name_confirmation is null
     or trim(p_family_name_confirmation) is distinct from v_family_name then
    raise exception
      'Borrado cancelado: p_family_name_confirmation no coincide con el nombre de la '
      'familia -- repetí el nombre exacto para confirmar el borrado' using errcode = '22023';
  end if;

  -- Conteo de todo lo que se va a borrar, ANTES de borrarlo.
  select jsonb_build_object(
    'family_members', (
      select count(*) from family_members where family_id = p_family_id
    ),
    'family_invitations', (
      select count(*) from family_invitations where family_id = p_family_id
    ),
    'cared_persons', (
      select count(*) from cared_persons where family_id = p_family_id
    ),
    'medical_contacts', (
      select count(*)
      from medical_contacts mc
      join cared_persons cp on cp.id = mc.cared_person_id
      where cp.family_id = p_family_id
    ),
    'emergency_contacts', (
      select count(*)
      from emergency_contacts ec
      join cared_persons cp on cp.id = ec.cared_person_id
      where cp.family_id = p_family_id
    ),
    'medications', (
      select count(*)
      from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id = p_family_id
    ),
    'medication_logs', (
      select count(*)
      from medication_logs ml
      join medications m on m.id = ml.medication_id
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id = p_family_id
    ),
    'shifts', (
      select count(*) from shifts where family_id = p_family_id
    ),
    'shift_handovers', (
      select count(*)
      from shift_handovers sh
      join shifts s on s.id = sh.shift_id
      where s.family_id = p_family_id
    )
  )
  into v_counts;

  -- PGM-13: enganche de auditoría, ANTES del delete (ver nota de diseño arriba de esta
  -- migración y en 20260915140000_delete_family_data_rpc.sql sobre el orden).
  perform log_family_rpc_audit_event(p_family_id, 'delete_family_data');

  -- El DELETE raíz -- todo lo demás cascadea vía FK `on delete cascade` ya existente.
  delete from families where id = p_family_id;

  get diagnostics v_deleted_rows = row_count;
  if v_deleted_rows <> 1 then
    raise exception 'No se pudo borrar la familia (fila no encontrada al momento del delete)'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deleted_family_id', p_family_id,
    'deleted_family_name', v_family_name,
    'deleted_at', now(),
    'deleted_by', auth.uid(),
    'deleted_counts', v_counts
  );
end;
$$;

comment on function public.delete_family_data(uuid, boolean, text) is
  'PGM-12/PGM-13: borrado total RGPD (art. 17) de una familia -- hard delete en cascada de '
  'family_members, family_invitations, cared_persons (con medical_contacts/'
  'emergency_contacts/medications/medication_logs anidados), shifts (con shift_handovers) y '
  'la propia familia. `security definer` a propósito: permite que CUALQUIER miembro de la '
  'familia lo invoque, con `is_family_member()` como único chequeo de autorización. Exige '
  'DOS confirmaciones explícitas obligatorias (p_confirm=true y '
  'p_family_name_confirmation=nombre exacto). Deja un registro en audit_events '
  '(action=''delete_family_data'') vía log_family_rpc_audit_event(), ANTES del delete para '
  'que quede registrado aunque algo falle a mitad del cascade -- family_id de ese registro '
  'queda en null tras el borrado (on delete set null, ver 20260915150000_audit_events.sql) '
  'pero entity_id preserva qué familia era. NO borra push_tokens ni auth.users. NO '
  'implementa "un miembro individual se va sin borrar la familia entera" -- decisión de '
  'producto explícitamente diferida, ver nota de alcance en '
  '20260915140000_delete_family_data_rpc.sql.';

revoke all on function public.delete_family_data(uuid, boolean, text) from public;
grant execute on function public.delete_family_data(uuid, boolean, text) to authenticated;
