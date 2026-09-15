-- PGM-13: [T6] Audit log -- tabla audit_events + triggers en tablas críticas
--
-- Objetivo (issue original): trazabilidad de acciones sensibles para soporte, incidentes y
-- cumplimiento. Esta migración cubre el modelo de datos completo: tabla, RLS, y triggers
-- automáticos en medication_logs/shifts/shift_handovers. El log MANUAL desde las RPCs RGPD
-- (export_family_data/delete_family_data, T4/T5 de la issue original) se completa en la
-- migración siguiente (20260915160000_audit_events_rpc_hooks.sql), que hace
-- `create or replace function` sobre esas dos RPCs ya aplicadas -- NUNCA se edita
-- directamente 20260915130000_export_family_data_rpc.sql ni
-- 20260915140000_delete_family_data_rpc.sql (son historial inmutable), mismo criterio que
-- 20260913241500_medications_rpc.sql -> 20260913243000_medications_write_rpc.sql.
--
-- Reusa, sin reimplementar:
--   * PGM-25 (20260913230000_shifts.sql): helper `is_family_member(uuid, uuid)`.
--   * PGM-15 (20260913203000_families_and_members.sql): `family_members`, patrón de
--     aislamiento por family_id.
--
-- ============================================================================
-- ⚠️ QUÉ NUNCA VA EN `metadata` -- ver advertencia del Tech Lead para esta issue
-- ============================================================================
-- `medication_logs.note` y los 4 campos de `shift_handovers` (resumen/comida/animo/
-- pendientes) son datos de salud cifrados (RGPD art. 9, ver PGM-3). Ninguno de los
-- triggers de esta migración vuelca su CONTENIDO (ni cifrado en bytea ni descifrado) en
-- `metadata` -- eso crearía una segunda copia de datos de salud en una tabla con retención/
-- acceso potencialmente distintos a los de la tabla de origen, socavando el propósito del
-- cifrado. `metadata` se limita acá a: qué acción ocurrió, NOMBRES de columna que cambiaron
-- (nunca sus valores), ids y booleanos de presencia (ej. "note_present": true) -- nunca el
-- contenido en sí. Comparaciones tipo `new.note is distinct from old.note` son seguras: solo
-- comparan bytes cifrados para producir un booleano/nombre de columna, nunca exponen ni
-- comparan el texto plano.
--
-- ============================================================================
-- DISEÑO: tabla `audit_events`
-- ============================================================================
--   - `actor_user_id`: SIEMPRE `auth.uid()` capturado en el momento del trigger/RPC, nunca
--     un parámetro que el cliente pueda pasar -- ver nota de seguridad en cada función más
--     abajo. `on delete set null`: un evento de auditoría debe sobrevivir aunque la cuenta
--     del actor se borre en el futuro (no existe todavía "borrado de cuenta" en este
--     producto, pero cuando exista, el registro histórico de auditoría no debería
--     desaparecer ni bloquear ese borrado -- a diferencia de `families.created_by`, que usa
--     `on delete restrict` porque ahí sí hace falta bloquear el borrado, ver esa migración).
--   - `family_id`: uuid SUELTO, sin FK a `families` -- a propósito, y no es un descuido.
--     Se intentó primero con `references families (id) on delete set null` (evitando
--     `on delete cascade` por el motivo obvio: `delete_family_data()` loguea el borrado
--     ANTES de `delete from families`, y un cascade borraría en la misma transacción la
--     fila de auditoría que se acaba de insertar). Se encontró empíricamente, corriendo el
--     fixture de `supabase/tests/delete_family_data.test.sql` contra esta migración, que
--     incluso `on delete set null` ROMPE: cuando `delete from families` cascadea hacia
--     `shifts`/`medication_logs`/`shift_handovers`, los triggers de auditoría de ESTA
--     migración (más abajo) intentan, DURANTE ese mismo cascade, insertar una fila nueva en
--     `audit_events` con `family_id = <la familia que se está borrando>` -- en ese punto la
--     fila de `families` YA fue eliminada del heap (el `DELETE FROM families` marca la fila
--     como borrada antes de disparar los triggers/acciones RI que cascadean a sus hijos), así
--     que el chequeo de FK de ese INSERT falla con `foreign_key_violation`, sin importar la
--     acción `on delete` configurada (esa acción solo aplica a filas que YA referenciaban a
--     `families` antes del delete, no a filas nuevas insertadas mientras el cascade está en
--     curso). Verificado con `npm run test:delete-family-data` fallando en rojo con esa FK
--     hasta sacarla. Por eso `family_id` acá es un uuid plano (mismo criterio que
--     `entity_id`, ver abajo): esta tabla necesita poder seguir registrando eventos sobre una
--     familia mientras esa misma familia desaparece en la misma transacción, algo que una FK
--     -- con cualquier acción `on delete` -- no puede expresar. La integridad referencial
--     "blanda" (¿el family_id apunta a algo que existió alguna vez?) es responsabilidad de
--     quien arma el INSERT (is_family_member()/las FKs de la tabla de origen ya la validaron
--     antes de que el trigger dispare), no de esta tabla.
--   - `entity` / `entity_id`: qué tabla/fila disparó el evento (ej. 'medication_logs' +
--     el id de esa fila; o 'family' + family_id, para los eventos manuales de export/delete).
--     `entity_id` es un uuid suelto (sin FK) porque apunta a filas de tablas distintas según
--     `entity` -- no se puede expresar como FK a una sola tabla.
--   - `action`: enum acotado (ver check) -- 'insert'/'update'/'delete' para los triggers
--     automáticos, 'export_family_data'/'delete_family_data' para el log manual de las RPCs
--     RGPD. Si en el futuro aparece un nuevo tipo de evento, se agrega con un ALTER
--     acotado -- mismo criterio YAGNI que el resto del schema (ver shifts.status,
--     family_members.role).
--   - `metadata`: jsonb, ver advertencia de arriba sobre qué NUNCA debe contener.
--
-- ============================================================================
-- DISEÑO: por qué NO hay policy de INSERT/UPDATE/DELETE para `authenticated`
-- ============================================================================
-- A propósito. Este proyecto no otorga grants de tabla explícitos (ver
-- supabase/migrations/20260913203000_families_and_members.sql, que documenta el mismo
-- criterio para UPDATE en `families`: "sin policy, RLS deniega todo [operación] por
-- defecto") -- Supabase ya concede privilegios base de tabla a `authenticated`/`anon` a
-- nivel de proyecto, así que RLS es la única barrera real. Si esta migración agregara una
-- policy de INSERT para `authenticated` (aunque fuera acotada), cualquier cliente podría
-- escribir directamente vía PostgREST (`POST /audit_events`) filas de auditoría falsas
-- (ej. fingir un `export_family_data` que nunca ocurrió, o negar que ocurrió uno real
-- agregando ruido) -- exactamente lo que esta tabla existe para evitar. En cambio, TODOS
-- los caminos de escritura pasan por funciones `security definer` acotadas (los 3 triggers
-- de abajo, y `log_family_rpc_audit_event()` en la migración siguiente): corren con los
-- privilegios del owner de la función (bypasean RLS de `audit_events`), pero cada una
-- decide internamente el `actor_user_id` (siempre `auth.uid()`) y valida lo que hace falta
-- antes de insertar -- mismo patrón exacto que `is_family_member()`/`delete_family_data()`
-- ya usan en este repo para exponer un permiso acotado sin exponer bypass de RLS genérico.

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Sin FK a `families` a propósito -- ver nota de diseño extensa arriba sobre el bug de
  -- foreign_key_violation encontrado empíricamente durante el cascade de delete_family_data.
  family_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null
    check (action in ('insert', 'update', 'delete', 'export_family_data', 'delete_family_data')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table audit_events is
  'PGM-13: log de auditoría de acciones sensibles (soporte/incidentes/cumplimiento). '
  'Alimentada por triggers automáticos en medication_logs/shifts/shift_handovers y por log '
  'manual desde export_family_data/delete_family_data (RGPD, ver '
  '20260915160000_audit_events_rpc_hooks.sql). NUNCA contiene el contenido de campos de '
  'salud cifrados (ver advertencia extensa en esta migración) -- solo qué ocurrió, cuándo, '
  'quién y NOMBRES de columna, nunca valores de columnas de salud. Sin policies de INSERT/'
  'UPDATE/DELETE para `authenticated` a propósito -- toda escritura pasa por funciones '
  '`security definer` acotadas, nunca por un INSERT directo del cliente (ver nota de diseño '
  'en esta migración).';

comment on column audit_events.actor_user_id is
  'Quién ejecutó la acción -- SIEMPRE auth.uid() capturado en el momento del trigger/RPC, '
  'nunca un valor que el cliente pueda pasar como parámetro (ver nota de seguridad en cada '
  'función de esta migración: ningún trigger/RPC acepta un "actor" como argumento). '
  'on delete set null: el registro histórico sobrevive aunque la cuenta del actor se borre '
  'en el futuro.';

comment on column audit_events.family_id is
  'Familia dueña del evento -- resuelta por cada trigger según la cadena de FKs de su '
  'tabla (shifts.family_id directo; shift_handovers vía shift_id -> shifts.family_id; '
  'medication_logs vía medication_id -> medications.cared_person_id -> '
  'cared_persons.family_id). Uuid SUELTO, sin FK a families -- a propósito, ver nota de '
  'diseño extensa en esta migración sobre el foreign_key_violation encontrado empíricamente '
  '(el cascade de delete_family_data borra la fila de families ANTES de que los triggers de '
  'sus hijos disparen, así que ninguna acción on delete puede cubrir un INSERT nuevo hecho '
  'durante ese mismo cascade). Puede quedar apuntando a una familia ya borrada -- eso es '
  'intencional, es el propósito de un log de auditoría.';

comment on column audit_events.entity is
  'Tabla/dominio que originó el evento (ej. ''medication_logs'', ''shifts'', '
  '''shift_handovers'', o ''family'' para los eventos manuales de las RPCs RGPD).';

comment on column audit_events.entity_id is
  'Id de la fila que originó el evento dentro de `entity` (o el family_id para eventos '
  '''family''). Sin FK -- apunta a tablas distintas según `entity`. A diferencia de '
  '`family_id`, este valor NO se pone en null si la fila/familia referenciada se borra '
  'después -- preserva qué id era, aunque ya no exista.';

comment on column audit_events.action is
  '''insert''/''update''/''delete'' para los triggers automáticos de medication_logs/'
  'shifts/shift_handovers; ''export_family_data''/''delete_family_data'' para el log '
  'manual de las RPCs RGPD (ver 20260915160000_audit_events_rpc_hooks.sql). Enum acotado a '
  'propósito (YAGNI) -- un nuevo tipo de evento futuro se agrega con un ALTER acotado.';

comment on column audit_events.metadata is
  'Contexto NO sensible del evento: nombres de columna que cambiaron (nunca sus valores), '
  'ids relacionados, booleanos de presencia. NUNCA contenido de columnas de salud cifradas '
  '(ni cifrado ni descifrado) -- ver advertencia extensa al inicio de esta migración.';

create index audit_events_family_id_created_at_idx
  on audit_events (family_id, created_at desc);

create index audit_events_entity_entity_id_idx
  on audit_events (entity, entity_id);

alter table audit_events enable row level security;

-- audit_events: solo miembros de la familia pueden leer sus propios eventos. Caso 1 del
-- patrón documentado en 20260913250000_rls_pattern_docs.sql (family_id propio, subquery no
-- recursiva a family_members). `family_id is not null` explícito: una fila con family_id en
-- null (familia ya borrada, ver on delete set null arriba) no puede matchear ninguna
-- membresía real -- se deja explícito por legibilidad, el `in (select ...)` ya lo excluiría
-- igual.
create policy audit_events_select_member
  on audit_events for select
  using (
    family_id is not null
    and family_id in (select family_id from family_members where user_id = auth.uid())
  );

-- Sin policies de INSERT/UPDATE/DELETE para `authenticated` -- ver nota de diseño extensa
-- arriba de esta migración. RLS deniega esas operaciones por defecto para cualquier rol no
-- privilegiado; toda escritura real pasa por las funciones `security definer` de abajo (y
-- por log_family_rpc_audit_event() en la migración siguiente).

-- ============================================================================
-- Triggers automáticos: medication_logs, shifts, shift_handovers
-- ============================================================================
-- Los tres siguen el mismo esqueleto: AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW,
-- función `security definer` (bypasea la RLS recién definida arriba SOLO para poder
-- insertar el evento, igual que is_family_member() bypasea family_members) que resuelve
-- family_id, arma un metadata NO sensible (ver advertencia arriba) y hace el insert. Si la
-- operación original está bloqueada por RLS (ej. un UPDATE que la policy ya rechaza), el
-- trigger nunca se dispara -- correcto y fuera de alcance de esta issue (ver alcance
-- realista acordado: solo se loguean operaciones que efectivamente ocurrieron).

-- ----------------------------------------------------------------------------------------
-- audit_medication_logs(): medication_logs -> medications -> cared_persons -> family_id
-- ----------------------------------------------------------------------------------------
-- `note` es bytea cifrado (RGPD art. 9) -- NUNCA se lee su valor acá, ni cifrado ni
-- descifrado. Solo se registra si estaba presente (insert/delete) o si cambió (update),
-- vía comparaciones sobre el valor cifrado (is not null / is distinct from), que nunca
-- exponen el contenido.
create or replace function audit_medication_logs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family_id uuid;
  v_entity_id uuid;
  v_metadata jsonb;
begin
  v_entity_id := coalesce(new.id, old.id);

  select cp.family_id into v_family_id
  from medications m
  join cared_persons cp on cp.id = m.cared_person_id
  where m.id = coalesce(new.medication_id, old.medication_id);

  if tg_op = 'INSERT' then
    v_metadata := jsonb_build_object(
      'medication_id', new.medication_id,
      'taken_by', new.taken_by,
      'note_present', new.note is not null
    );
  elsif tg_op = 'UPDATE' then
    v_metadata := jsonb_build_object(
      'medication_id', new.medication_id,
      'fields_changed', (
        select coalesce(jsonb_agg(f), '[]'::jsonb) from (
          select 'taken_by' as f where new.taken_by is distinct from old.taken_by
          union all
          select 'taken_at' where new.taken_at is distinct from old.taken_at
          union all
          select 'note' where new.note is distinct from old.note
        ) changed
      )
    );
  else
    v_metadata := jsonb_build_object(
      'medication_id', old.medication_id,
      'taken_by', old.taken_by
    );
  end if;

  insert into audit_events (actor_user_id, family_id, entity, entity_id, action, metadata)
  values (auth.uid(), v_family_id, 'medication_logs', v_entity_id, lower(tg_op), v_metadata);

  return coalesce(new, old);
end;
$$;

comment on function audit_medication_logs() is
  'PGM-13: trigger AFTER INSERT/UPDATE/DELETE de medication_logs -> audit_events. '
  '`security definer` a propósito -- bypasea la RLS de audit_events (ninguna policy de '
  'INSERT existe para authenticated) para poder insertar el evento; el actor SIEMPRE es '
  'auth.uid() capturado acá, nunca un valor que el cliente controle (no es un parámetro de '
  'esta función). NUNCA lee/expone el contenido de medication_logs.note (bytea cifrado, '
  'RGPD art. 9) -- solo si estaba presente o si cambió, ver advertencia en esta migración.';

revoke all on function audit_medication_logs() from public;

create trigger medication_logs_audit
  after insert or update or delete on medication_logs
  for each row execute function audit_medication_logs();

-- ----------------------------------------------------------------------------------------
-- audit_shifts(): shifts.family_id directo -- ninguna columna de shifts está cifrada, así
-- que su metadata puede incluir los campos no sensibles directamente (status, cared_person_id,
-- assigned_to, rango horario) sin riesgo -- no hay datos de salud en esta tabla.
-- ----------------------------------------------------------------------------------------
create or replace function audit_shifts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_metadata jsonb;
  v_entity_id uuid;
  v_family_id uuid;
begin
  v_entity_id := coalesce(new.id, old.id);
  v_family_id := coalesce(new.family_id, old.family_id);

  if tg_op = 'INSERT' then
    v_metadata := jsonb_build_object(
      'cared_person_id', new.cared_person_id,
      'assigned_to', new.assigned_to,
      'status', new.status
    );
  elsif tg_op = 'UPDATE' then
    v_metadata := jsonb_build_object(
      'status', new.status,
      'fields_changed', (
        select coalesce(jsonb_agg(f), '[]'::jsonb) from (
          select 'cared_person_id' as f where new.cared_person_id is distinct from old.cared_person_id
          union all
          select 'assigned_to' where new.assigned_to is distinct from old.assigned_to
          union all
          select 'starts_at' where new.starts_at is distinct from old.starts_at
          union all
          select 'ends_at' where new.ends_at is distinct from old.ends_at
          union all
          select 'status' where new.status is distinct from old.status
        ) changed
      )
    );
  else
    v_metadata := jsonb_build_object(
      'cared_person_id', old.cared_person_id,
      'assigned_to', old.assigned_to,
      'status', old.status
    );
  end if;

  insert into audit_events (actor_user_id, family_id, entity, entity_id, action, metadata)
  values (auth.uid(), v_family_id, 'shifts', v_entity_id, lower(tg_op), v_metadata);

  return coalesce(new, old);
end;
$$;

comment on function audit_shifts() is
  'PGM-13: trigger AFTER INSERT/UPDATE/DELETE de shifts -> audit_events. `security '
  'definer` a propósito -- mismo criterio que audit_medication_logs(). shifts no tiene '
  'columnas cifradas, así que su metadata incluye directamente status/cared_person_id/'
  'assigned_to/fechas -- ninguno es un dato de salud del Art. 9.';

revoke all on function audit_shifts() from public;

create trigger shifts_audit
  after insert or update or delete on shifts
  for each row execute function audit_shifts();

-- ----------------------------------------------------------------------------------------
-- audit_shift_handovers(): shift_handovers -> shifts.family_id (dos niveles). Los 4 campos
-- de contenido son bytea cifrados (resumen/comida/animo/pendientes) -- NUNCA se lee su
-- valor, solo se registra el NOMBRE del campo si está presente (insert) o si cambió
-- (update), vía comparaciones sobre bytes cifrados.
-- ----------------------------------------------------------------------------------------
create or replace function audit_shift_handovers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_metadata jsonb;
  v_entity_id uuid;
  v_family_id uuid;
  v_shift_id uuid;
begin
  v_entity_id := coalesce(new.id, old.id);
  v_shift_id := coalesce(new.shift_id, old.shift_id);

  select s.family_id into v_family_id from shifts s where s.id = v_shift_id;

  if tg_op = 'INSERT' then
    v_metadata := jsonb_build_object(
      'shift_id', new.shift_id,
      'fields_set', (
        select coalesce(jsonb_agg(f), '[]'::jsonb) from (
          select 'resumen' as f where new.resumen is not null
          union all
          select 'comida' where new.comida is not null
          union all
          select 'animo' where new.animo is not null
          union all
          select 'pendientes' where new.pendientes is not null
        ) present
      )
    );
  elsif tg_op = 'UPDATE' then
    v_metadata := jsonb_build_object(
      'shift_id', new.shift_id,
      'fields_changed', (
        select coalesce(jsonb_agg(f), '[]'::jsonb) from (
          select 'resumen' as f where new.resumen is distinct from old.resumen
          union all
          select 'comida' where new.comida is distinct from old.comida
          union all
          select 'animo' where new.animo is distinct from old.animo
          union all
          select 'pendientes' where new.pendientes is distinct from old.pendientes
        ) changed
      )
    );
  else
    v_metadata := jsonb_build_object('shift_id', old.shift_id);
  end if;

  insert into audit_events (actor_user_id, family_id, entity, entity_id, action, metadata)
  values (auth.uid(), v_family_id, 'shift_handovers', v_entity_id, lower(tg_op), v_metadata);

  return coalesce(new, old);
end;
$$;

comment on function audit_shift_handovers() is
  'PGM-13: trigger AFTER INSERT/UPDATE/DELETE de shift_handovers -> audit_events. '
  '`security definer` a propósito -- mismo criterio que audit_medication_logs(). NUNCA lee '
  'el contenido de resumen/comida/animo/pendientes (los 4 bytea cifrados, RGPD art. 9) -- '
  'solo registra NOMBRES de campo presentes/cambiados vía comparaciones sobre bytes '
  'cifrados, ver advertencia extensa al inicio de esta migración.';

revoke all on function audit_shift_handovers() from public;

create trigger shift_handovers_audit
  after insert or update or delete on shift_handovers
  for each row execute function audit_shift_handovers();
