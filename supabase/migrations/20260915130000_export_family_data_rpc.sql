-- PGM-11: [T4] Endpoint RGPD -- export completo de datos de la familia (art. 20).
--
-- ============================================================================
-- ALCANCE ELEGIDO vs. la issue original -- 3 desvíos deliberados, documentados acá
-- ============================================================================
--
-- 1) "Edge Function" -> RPC `security invoker` en su lugar.
--    La issue original pide una Edge Function protegida. Este repo NO tiene ninguna Edge
--    Function todavía (confirmado con `ls supabase/` -- no existe `supabase/functions/`,
--    ver también la nota de alcance de 20260915120000_push_tokens.sql, que documentó el
--    mismo gap para `send_push`). El requisito REAL de PGM-11 ("devolver JSON con todos los
--    datos de la familia, con los campos de salud ya descifrados") no exige un endpoint HTTP
--    separado -- el resto del backend de este proyecto ya resuelve exactamente este patrón
--    (lectura compleja + descifrado server-side) con RPCs `security invoker`/`security
--    definer` (ver get_medications_for_family/get_medication_logs_for_family en
--    20260913241500_medications_rpc.sql / 20260914150000_medication_logs_history_rpc.sql).
--    El cliente invoca `export_family_data(p_family_id)` con `.rpc()`, igual que cualquier
--    otra operación de este repo -- construir una Edge Function nueva desde cero para esto
--    sería sobre-ingeniería (infra de despliegue, secrets, autenticación propia) para un
--    requisito que ya resuelve el patrón RPC existente.
--
-- 2) Log de auditoría (T6/PGM-13) -- NO implementado, tabla `audit_events` no existe todavía.
--    Confirmado repasando supabase/migrations/ completo antes de escribir esta migración:
--    no hay ninguna tabla `audit_events` ni mención de ella en el repo. Esa tabla es
--    responsabilidad de PGM-13 (issue de Backend todavía pendiente en la cola) -- no se
--    inventa acá un diseño a medias de esa tabla, sería asumir un diseño que le corresponde
--    decidir a esa issue (columnas, retención, qué eventos loguea además de exports, etc.).
--    PUNTO DE ENGANCHE FUTURO: cuando PGM-13 cree `audit_events`, agregar ahí mismo (en la
--    migración de PGM-13, o en una migración nueva que haga `create or replace function
--    public.export_family_data`) un `insert into audit_events (...)` justo después del check
--    de membresía de más abajo (buscar el comentario "PGM-13: enganchar acá el log de
--    auditoría" en el cuerpo de la función). Hasta entonces, esta RPC NO deja ningún rastro
--    de quién exportó qué -- riesgo aceptado y documentado, ver NOTES del agente.
--
-- 3) "Documentos (...) + URLs firmadas de Storage" -- excluido, no existe bucket de Storage.
--    Revisado `supabase/config.toml` (solo tiene la sección genérica `[storage.s3_protocol]`
--    de la CLI de Supabase, no un bucket de la app) y docs/product-vision.md completo: no hay
--    ninguna feature de "documentos de la persona cuidada" implementada ni un bucket
--    configurado en ninguna migración. Se excluye esa parte del export en vez de inventar
--    URLs firmadas sin storage real detrás -- cuando exista esa feature (tabla de referencias
--    a documentos + bucket), agregar un campo `'documents'` al jsonb de más abajo con las
--    URLs firmadas (`storage.create_signed_url` o el RPC que corresponda en ese momento).
--
-- ============================================================================
-- QUÉ SÍ incluye el export (árbol completo, ya descifrado)
-- ============================================================================
-- family, members (vía list_family_members(), PGM-27), cared_persons (con condition_notes
-- descifrado), medical_contacts ("doctores"), emergency_contacts ("contactos"), medications
-- (con name/dose/instructions descifrados) con sus medication_logs anidados (con note
-- descifrado), shifts con su shift_handover anidado si existe (con resumen/comida/animo/
-- pendientes descifrados).
--
-- QUÉ NO incluye, a propósito (además de documentos, ver punto 3 arriba):
--   * `family_invitations`: son tokens de invitación (credenciales operativas de acceso, no
--     datos personales del titular en el sentido del art. 20) -- exponerlas en un export
--     descargable sería un riesgo de seguridad (un token vigente filtrado en un archivo
--     exportado) sin que el RGPD lo exija. Si un Tech Lead futuro decide que sí deben
--     incluirse (ej. solo metadata sin el token crudo), es un `jsonb_build_object` adicional
--     acá, no un cambio de diseño.
--   * `push_tokens`: son credenciales técnicas de entrega de notificaciones (equivalentes a
--     un token FCM/APNs), no datos de salud/cuidado de la familia -- mismo criterio que
--     excluirlas de la lista canónica de cifrado en PGM-3. Fuera del alcance de "todos los
--     datos de la familia" en el sentido que importa para portabilidad (nadie pide poder
--     "portar" su token de push a otro proveedor).
--
-- ============================================================================
-- DISEÑO TÉCNICO: por qué `security invoker` (no `security definer`)
-- ============================================================================
-- A diferencia de accept_family_invitation()/list_family_members() (que SÍ necesitan
-- `security definer` para leer filas de OTROS usuarios en `family_members`, bypaseando
-- `family_members_select_own`), esta función NO necesita bypasear RLS para la mayoría de las
-- tablas: `cared_persons_select_member`, `medications_select_member`,
-- `medication_logs_select_member`, `shifts_select_member`, `shift_handovers_select_member` y
-- `families_select_member` ya permiten a CUALQUIER miembro de la familia ver TODAS las filas
-- de esa familia (no están limitadas "solo mis propias filas", a diferencia de
-- `family_members`). El único punto que sí requiere bypass (listar a los demás miembros, no
-- solo la fila propia) se resuelve reutilizando `list_family_members()` (PGM-27,
-- `security definer`, ya validado y testeado) en vez de duplicar ese bypass acá. Resultado:
-- esta función es `security invoker`, con el criterio "menor privilegio posible" ya usado en
-- `get_medications_for_family`/`create_cared_person` -- los filtros `= p_family_id` de abajo
-- son conveniencia de query, la RLS de cada tabla sigue aplicando y es la que realmente
-- aísla los datos.
--
-- Se agrega igual un chequeo explícito de membresía al principio (`is_family_member`) para
-- devolver un error legible (`insufficient_privilege`) en vez de un jsonb "vacío pero con
-- forma" cuando alguien pasa el `p_family_id` de una familia ajena -- una respuesta vacía
-- pero con la forma esperada podría malinterpretarse como "esta familia no tiene datos" en
-- vez de "no tenés acceso", indeseable específicamente para un endpoint de export legal.
--
-- `stable` (no `volatile`): esta función solo lee, no escribe nada (aparte del futuro insert
-- en audit_events de PGM-13 -- cuando se agregue ese insert, esta función deja de ser
-- `stable` y pasa a `volatile`, ver el punto de enganche más abajo).

create or replace function public.export_family_data(p_family_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_family_id is null then
    raise exception 'p_family_id es obligatorio' using errcode = '22023'; -- invalid_parameter_value
  end if;

  -- Chequeo explícito de membresía (defense in depth + error legible) -- ver nota de diseño
  -- extensa arriba de esta función sobre por qué no basta con dejar que las RLS de cada
  -- tabla devuelvan silenciosamente arrays vacíos.
  if not is_family_member(p_family_id, auth.uid()) then
    raise exception 'No sos miembro de esta familia' using errcode = '42501'; -- insufficient_privilege
  end if;

  -- PGM-13: enganchar acá el log de auditoría (audit_events) cuando esa tabla exista --
  -- ej. `insert into audit_events (event, actor_id, family_id, created_at) values
  -- ('export_family_data', auth.uid(), p_family_id, now());`. No implementado en esta issue
  -- (PGM-11) porque audit_events todavía no existe -- ver punto 2 de la nota de alcance al
  -- inicio de esta migración.

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
      -- security definer reusado de PGM-27 -- ver nota de diseño arriba sobre por qué es el
      -- único punto de esta función que necesita bypasear la RLS dueño-only de
      -- family_members. Ya valida membresía internamente; con el guard de arriba, nunca
      -- devuelve 0 miembros para una familia real de la que el caller es parte.
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
  'PGM-11: export RGPD (art. 20) completo de los datos de la familia p_family_id -- familia, '
  'miembros, personas cuidadas (con condition_notes descifrado), doctores/contactos de '
  'emergencia, medicaciones (descifradas) con su historial de tomas anidado (descifrado), y '
  'turnos con su traspaso anidado si existe (descifrado). `security invoker`: NO amplía '
  'permisos -- cada subconsulta sigue sujeta a la RLS de su tabla (member-scoped en todas '
  'menos family_members, resuelta reusando list_family_members() de PGM-27). Devuelve '
  'insufficient_privilege si el caller no es miembro de p_family_id (chequeo explícito, no '
  'delegado silenciosamente a que las RLS devuelvan arrays vacíos -- ver nota de diseño en '
  'esta migración). NO incluye documentos (no existe bucket de Storage todavía) ni '
  'family_invitations/push_tokens (fuera del alcance de portabilidad de datos personales, '
  'ver nota de alcance). NO deja registro en audit_events -- esa tabla no existe todavía '
  '(PGM-13, pendiente); ver el comentario "PGM-13: enganchar acá" en el cuerpo de esta '
  'función para el punto de enganche futuro.';

revoke all on function public.export_family_data(uuid) from public;
grant execute on function public.export_family_data(uuid) to authenticated;
