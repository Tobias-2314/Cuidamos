-- PGM-13: smoke test de audit_events -- RLS, triggers automáticos (medication_logs/shifts/
-- shift_handovers) y el helper log_family_rpc_audit_event() usado por las RPCs RGPD.
--
-- Verifica los invariantes no negociables de esta issue:
--   1) Aislamiento RLS: un usuario de la Familia A no puede leer eventos de auditoría de la
--      Familia B (mismo patrón que el resto de los tests de este proyecto).
--   2) Ningún INSERT directo a audit_events funciona bajo `authenticated` -- ni siquiera
--      para la propia familia -- porque la tabla no tiene policy de INSERT a propósito (ver
--      nota de diseño en 20260915150000_audit_events.sql). Toda escritura pasa por
--      funciones `security definer`.
--   3) Los triggers de medication_logs/shifts/shift_handovers disparan automáticamente en
--      INSERT/UPDATE/DELETE, resuelven family_id correctamente (directo para shifts, vía
--      shift_id para shift_handovers, vía medication_id->cared_person_id para
--      medication_logs) y el actor registrado es SIEMPRE quien ejecutó la operación
--      (auth.uid()), nunca un valor tomado de una columna de la fila (ej. taken_by).
--   4) `metadata` nunca contiene el contenido de columnas de salud cifradas (note de
--      medication_logs; resumen/comida/animo/pendientes de shift_handovers) -- ni cifrado
--      ni descifrado -- solo nombres de columna y booleanos de presencia.
--   5) log_family_rpc_audit_event(): solo acepta las dos acciones soportadas, exige
--      membresía de la familia, y el actor registrado es siempre auth.uid().
--
-- Cómo correrlo:
--   npm run db:start   (una vez, si el stack local no está arriba)
--   *** Requiere que la GUC app.settings.encryption_key ya esté seteada en esta sesión de
--       Postgres -- ver sección 2 de supabase/migrations/20260913210000_encryption_helpers.sql
--       y el paso manual en el README (medications/shift_handovers de este fixture usan
--       extensions.encrypt_text). ***
--   npm run test:audit-events
--
-- Mismas convenciones que el resto de supabase/tests/*.test.sql: un único bloque
-- `do $$ ... $$`, limpieza explícita en el camino feliz y en `exception`, UUIDs fijos con
-- prefijo d.../ad... que no colisiona con otros archivos de test.

do $$
declare
  user_a constant uuid := 'd1111111-1111-1111-1111-111111111111'; -- admin, familia A
  user_c constant uuid := 'd3333333-3333-3333-3333-333333333333'; -- cuidador, familia A (2do miembro real)
  user_b constant uuid := 'd2222222-2222-2222-2222-222222222222'; -- admin, familia B (otra familia)
  family_a constant uuid := 'ad111111-1111-1111-1111-111111111111';
  family_b constant uuid := 'ad222222-2222-2222-2222-222222222222';
  cared_a constant uuid := 'ad311111-1111-1111-1111-111111111111';
  medication_a constant uuid := 'ad411111-1111-1111-1111-111111111111';
  shift_a constant uuid := 'ad511111-1111-1111-1111-111111111111';
  handover_a constant uuid := 'ad611111-1111-1111-1111-111111111111';
  matched int;
  affected int;
  v_event_id uuid;
  v_actor uuid;
  v_family uuid;
  v_action text;
  v_metadata jsonb;
  v_metadata_text text;
  v_medication_log_id uuid;
begin
  -- 1) Fixture: como `postgres` (bypassa RLS), dos familias con miembros reales.
  insert into auth.users (id) values (user_a), (user_b), (user_c);

  insert into families (id, name, created_by) values
    (family_a, 'Familia A', user_a),
    (family_b, 'Familia B', user_b);

  insert into family_members (family_id, user_id, role) values
    (family_a, user_a, 'admin'),
    (family_a, user_c, 'cuidador'),
    (family_b, user_b, 'admin');

  insert into cared_persons (id, family_id, full_name, consent_given_at, created_by) values
    (cared_a, family_a, 'Persona cuidada A', now(), user_a);

  insert into medications (id, cared_person_id, name, dose, created_by) values
    (medication_a, cared_a, extensions.encrypt_text('Ibuprofeno'), extensions.encrypt_text('400mg'), user_a);

  -- 2) A partir de acá actuamos como `authenticated`, logueados como user_a (Familia A).
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );

  if auth.uid() is distinct from user_a then
    raise exception 'setup inválido: auth.uid() = % (esperado %)', auth.uid(), user_a;
  end if;

  -- ==========================================================================
  -- 3) Trigger de shifts: INSERT dispara un evento con family_id resuelto directo.
  -- ==========================================================================
  insert into shifts (id, family_id, cared_person_id, assigned_to, starts_at, ends_at, created_by)
  values (shift_a, family_a, cared_a, user_a, now() - interval '8 hours', now(), user_a);

  select id, actor_user_id, family_id, action
    into v_event_id, v_actor, v_family, v_action
    from audit_events
    where entity = 'shifts' and entity_id = shift_a and action = 'insert';

  if v_event_id is null then
    raise exception 'FALLO TRIGGER: no se creó audit_event para el INSERT de shifts';
  end if;
  if v_actor is distinct from user_a then
    raise exception 'FALLO ACTOR: audit_event de shifts INSERT tiene actor % (esperado %)', v_actor, user_a;
  end if;
  if v_family is distinct from family_a then
    raise exception 'FALLO family_id: audit_event de shifts INSERT tiene family_id % (esperado %)', v_family, family_a;
  end if;

  -- UPDATE: fields_changed debe incluir 'status', metadata trae el nuevo status (no es
  -- sensible, shifts no tiene columnas cifradas).
  update shifts set status = 'completed' where id = shift_a;

  select metadata into v_metadata
    from audit_events
    where entity = 'shifts' and entity_id = shift_a and action = 'update';

  if v_metadata is null or not (v_metadata -> 'fields_changed' ? 'status') then
    raise exception 'FALLO TRIGGER UPDATE: fields_changed de shifts no incluye ''status'' (metadata: %)', v_metadata;
  end if;
  if v_metadata ->> 'status' is distinct from 'completed' then
    raise exception 'FALLO TRIGGER UPDATE: metadata.status no refleja el nuevo valor (obtuvo: %)', v_metadata;
  end if;

  -- ==========================================================================
  -- 4) Trigger de medication_logs: el actor es quien ejecuta el INSERT (user_a), NO
  --    taken_by (user_c) -- un admin registra retroactivamente la toma de otro cuidador.
  --    note NUNCA aparece en metadata (ni cifrado ni descifrado), solo note_present.
  -- ==========================================================================
  insert into medication_logs (medication_id, taken_by, taken_at, note)
  values (medication_a, user_c, now(), extensions.encrypt_text('nota de salud secreta'))
  returning id into v_medication_log_id;

  select actor_user_id, family_id, metadata
    into v_actor, v_family, v_metadata
    from audit_events
    where entity = 'medication_logs' and entity_id = v_medication_log_id and action = 'insert';

  if v_actor is distinct from user_a then
    raise exception 'FALLO ACTOR: audit_event de medication_logs INSERT tiene actor % (esperado auth.uid()=%)', v_actor, user_a;
  end if;
  if v_family is distinct from family_a then
    raise exception 'FALLO family_id (cadena medication_logs->medications->cared_persons): obtuvo %, esperado %', v_family, family_a;
  end if;
  if (v_metadata ->> 'taken_by')::uuid is distinct from user_c then
    raise exception 'FALLO metadata: taken_by no quedó registrado (metadata: %)', v_metadata;
  end if;
  if (v_metadata ->> 'note_present') is distinct from 'true' then
    raise exception 'FALLO metadata: note_present debería ser true (metadata: %)', v_metadata;
  end if;
  if v_metadata ? 'note' then
    raise exception 'FALLO SEGURIDAD: metadata de medication_logs expone la clave ''note'' -- nunca debe volcarse el contenido';
  end if;

  v_metadata_text := v_metadata::text;
  if position('secreta' in v_metadata_text) > 0 then
    raise exception 'FALLO SEGURIDAD: metadata de medication_logs contiene texto plano de una nota de salud';
  end if;

  -- UPDATE de note: fields_changed debe nombrar 'note' sin exponer el valor.
  update medication_logs set note = extensions.encrypt_text('nota actualizada, aun secreta')
    where id = v_medication_log_id;

  select metadata into v_metadata
    from audit_events
    where entity = 'medication_logs' and entity_id = v_medication_log_id and action = 'update';

  if v_metadata is null or not (v_metadata -> 'fields_changed' ? 'note') then
    raise exception 'FALLO TRIGGER UPDATE: fields_changed de medication_logs no incluye ''note'' (metadata: %)', v_metadata;
  end if;
  if position('actualizada' in v_metadata::text) > 0 then
    raise exception 'FALLO SEGURIDAD: metadata del UPDATE de medication_logs contiene texto plano';
  end if;

  -- ==========================================================================
  -- 5) Trigger de shift_handovers: family_id resuelto vía shift_id -> shifts.family_id.
  --    Los 4 campos de contenido NUNCA aparecen en metadata -- solo fields_set/fields_changed
  --    con los NOMBRES de los campos presentes/modificados.
  -- ==========================================================================
  insert into shift_handovers (id, shift_id, resumen, comida, created_by)
  values (
    handover_a, shift_a,
    extensions.encrypt_text('Turno tranquilo'),
    extensions.encrypt_text('Almorzó bien'),
    user_a
  );

  select actor_user_id, family_id, metadata
    into v_actor, v_family, v_metadata
    from audit_events
    where entity = 'shift_handovers' and entity_id = handover_a and action = 'insert';

  if v_actor is distinct from user_a then
    raise exception 'FALLO ACTOR: audit_event de shift_handovers INSERT tiene actor % (esperado %)', v_actor, user_a;
  end if;
  if v_family is distinct from family_a then
    raise exception 'FALLO family_id (cadena shift_handovers->shifts): obtuvo %, esperado %', v_family, family_a;
  end if;
  if not (v_metadata -> 'fields_set' ? 'resumen' and v_metadata -> 'fields_set' ? 'comida') then
    raise exception 'FALLO metadata: fields_set debería incluir resumen y comida (metadata: %)', v_metadata;
  end if;
  if (v_metadata -> 'fields_set' ? 'animo') or (v_metadata -> 'fields_set' ? 'pendientes') then
    raise exception 'FALLO metadata: fields_set no debería incluir animo/pendientes (son null en este insert) (metadata: %)', v_metadata;
  end if;
  if position('tranquilo' in v_metadata::text) > 0 or position('Almorzó' in v_metadata::text) > 0 then
    raise exception 'FALLO SEGURIDAD: metadata de shift_handovers contiene texto plano de un traspaso';
  end if;

  update shift_handovers set resumen = extensions.encrypt_text('Turno con incidente') where id = handover_a;

  select metadata into v_metadata
    from audit_events
    where entity = 'shift_handovers' and entity_id = handover_a and action = 'update';

  if v_metadata is null or not (v_metadata -> 'fields_changed' ? 'resumen') then
    raise exception 'FALLO TRIGGER UPDATE: fields_changed de shift_handovers no incluye ''resumen'' (metadata: %)', v_metadata;
  end if;
  if position('incidente' in v_metadata::text) > 0 then
    raise exception 'FALLO SEGURIDAD: metadata del UPDATE de shift_handovers contiene texto plano';
  end if;

  delete from shift_handovers where id = handover_a;

  select count(*) into matched
    from audit_events
    where entity = 'shift_handovers' and entity_id = handover_a and action = 'delete';
  if matched <> 1 then
    raise exception 'FALLO TRIGGER DELETE: no se registró el borrado de shift_handovers (% filas)', matched;
  end if;

  -- ==========================================================================
  -- 6) log_family_rpc_audit_event(): acción soportada + membresía propia -> OK.
  -- ==========================================================================
  perform log_family_rpc_audit_event(family_a, 'export_family_data');

  select actor_user_id, action into v_actor, v_action
    from audit_events
    where entity = 'family' and entity_id = family_a and action = 'export_family_data'
    order by created_at desc
    limit 1;

  if v_actor is distinct from user_a then
    raise exception 'FALLO ACTOR: log_family_rpc_audit_event no registró auth.uid() como actor (obtuvo %)', v_actor;
  end if;

  -- Acción no soportada -> rechazada, no inserta nada.
  begin
    perform log_family_rpc_audit_event(family_a, 'algo_no_soportado');
    raise exception 'FALLO: log_family_rpc_audit_event debería rechazar una acción no soportada';
  exception
    when invalid_parameter_value then
      null; -- esperado
  end;

  -- Familia ajena -> rechazada por is_family_member(), no inserta nada.
  begin
    perform log_family_rpc_audit_event(family_b, 'export_family_data');
    raise exception 'FALLO RLS: log_family_rpc_audit_event permitió loguear un evento para una familia ajena';
  exception
    when insufficient_privilege then
      null; -- esperado
  end;

  select count(*) into matched from audit_events where entity_id = family_b;
  if matched <> 0 then
    raise exception 'FALLO: quedó un audit_event para family_b pese a que la llamada debía fallar';
  end if;

  -- ==========================================================================
  -- 7) Ningún INSERT directo a audit_events funciona bajo `authenticated`, ni siquiera
  --    para la propia familia -- no hay policy de INSERT a propósito.
  -- ==========================================================================
  begin
    insert into audit_events (actor_user_id, family_id, entity, entity_id, action)
    values (user_a, family_a, 'family', family_a, 'export_family_data');
    raise exception 'FALLO SEGURIDAD: un usuario pudo insertar directamente en audit_events';
  exception
    when insufficient_privilege then
      null; -- esperado: sin policy de INSERT, RLS bloquea.
  end;

  -- ==========================================================================
  -- 8) Aislamiento RLS: user_a (Familia A) no puede leer eventos de la Familia B.
  -- ==========================================================================
  select count(*) into matched from audit_events where family_id = family_b;
  if matched <> 0 then
    raise exception 'FALLO RLS: user_a pudo leer audit_events de la Familia B (% filas)', matched;
  end if;

  -- Control positivo: sí puede leer los suyos.
  select count(*) into matched from audit_events where family_id = family_a;
  if matched < 1 then
    raise exception 'FALLO: user_a no pudo leer sus propios audit_events (% filas)', matched;
  end if;

  raise notice 'PGM-13 audit_events smoke test: OK (RLS, triggers de shifts/medication_logs/shift_handovers y log_family_rpc_audit_event verificados)';

  -- 9) Limpieza del fixture (camino feliz): volvemos a un rol que bypassea RLS.
  reset role;
  delete from audit_events where family_id in (family_a, family_b) or entity_id in (family_a, family_b);
  delete from medication_logs where medication_id = medication_a;
  delete from medications where id = medication_a;
  delete from shifts where family_id in (family_a, family_b);
  delete from cared_persons where id = cared_a;
  delete from family_members where family_id in (family_a, family_b);
  delete from families where id in (family_a, family_b);
  delete from auth.users where id in (user_a, user_b, user_c);

exception
  when others then
    reset role;
    delete from audit_events where family_id in (family_a, family_b) or entity_id in (family_a, family_b);
    delete from medication_logs where medication_id = medication_a;
    delete from medications where id = medication_a;
    delete from shifts where family_id in (family_a, family_b);
    delete from cared_persons where id = cared_a;
    delete from family_members where family_id in (family_a, family_b);
    delete from families where id in (family_a, family_b);
    delete from auth.users where id in (user_a, user_b, user_c);
    raise;
end $$;
