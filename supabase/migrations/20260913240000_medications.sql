-- PGM-30: Modelo de datos: medications, medication_logs (quién, cuándo, nota)
--
-- F4 (medicación). Criterio de producto: "marca 'dado' con hora real y nota -- acción
-- crítica de alta frecuencia, <3 tap". Esta issue es solo el modelo de datos (tablas +
-- RLS + cifrado): el scheduler/recordatorios y la UI de <3 tap quedan para issues de
-- Frontend/Backend posteriores del épico F4 -- ver NOTES del agente.
--
-- Datos de salud (RGPD art. 9): mismo requisito de cifrado en reposo que la Épica 2
-- (F2/PGM-21). Campos a cifrar, según la lista canónica de PGM-3
-- (20260913210000_encryption_helpers.sql, sección "CAMPOS DE SALUD A CIFRAR"):
--   * medications.name
--   * medications.dose
--   * medications.instructions
--   * medication_logs.note
-- (El diseño final coincide exactamente con esa lista -- no hizo falta actualizarla.)
--
-- Reusa, sin reimplementar:
--   * PGM-15 (20260913203000_families_and_members.sql): `family_members`, patrón de
--     aislamiento ad-hoc no recursivo vía subquery directa (`family_id in (select
--     family_id from family_members where user_id = auth.uid())`) para "¿SOY YO miembro
--     de esta familia?".
--   * PGM-21 (20260913220000_cared_persons.sql): `cared_persons` y el patrón de RLS con
--     subquery a `cared_persons` para tablas hijas (mismo patrón que
--     `medical_contacts`/`emergency_contacts`), aplicado acá a `medications`.
--   * PGM-25 (20260913230000_shifts.sql): helper `is_family_member(p_family_id uuid,
--     p_user_id uuid) returns boolean` (`security definer`) -- se reusa TAL CUAL (no se
--     redefine acá) para validar que `medication_logs.taken_by` sea un miembro real de la
--     familia dueña de la medicación, sin importar si es quien registra el log o no. Ver
--     el comentario extenso de esa función en 20260913230000_shifts.sql para el detalle
--     completo de por qué hace falta (una subquery directa a `family_members` para
--     preguntar por OTRO usuario queda ella misma sujeta a la RLS "solo mi propia fila" de
--     `family_members_select_own`, y se reduce silenciosamente a `= auth.uid()`).
--   * PGM-3 (20260913210000_encryption_helpers.sql): `extensions.encrypt_text(text)` /
--     `extensions.decrypt_text(bytea)` para los campos cifrados.
--
-- ----------------------------------------------------------------------------------------
-- DISEÑO: `medications`
-- ----------------------------------------------------------------------------------------
--   - `cared_person_id`: de qué persona cuidada es el medicamento. on delete cascade
--     (mismo criterio que medical_contacts/emergency_contacts en PGM-21 -- si se borra la
--     cared_person, no tiene sentido conservar sus medicamentos sueltos).
--   - `name` / `dose` / `instructions`: bytea cifrados (ver lista canónica arriba).
--     `instructions` nullable (no todo medicamento necesita instrucciones especiales);
--     `name`/`dose` NOT NULL -- un medicamento sin nombre o sin dosis no es un registro
--     útil.
--   - `schedule`: DECISIÓN DE DISEÑO (YAGNI) -- se modela como `text` libre (ej. "cada 8
--     horas", "08:00, 14:00, 22:00", "con el desayuno"). Se evaluó modelarlo como
--     `time[]` (array de horas del día) para poder generar recordatorios automáticos, pero
--     esta issue es solo el modelo de datos base -- un scheduler real (que dispare
--     notificaciones a horarios específicos, maneje "cada N horas" vs. horas fijas, zonas
--     horarias, etc.) es una pieza de lógica de negocio no trivial que no tiene todavía un
--     caso de uso confirmado ni una issue que la pida. Un `text` libre desbloquea F4 (crear
--     medicamentos, listarlos, marcarlos como dados) sin comprometerse a una estructura de
--     horario que probablemente haya que rediseñar cuando llegue esa issue de scheduler.
--     Si/cuando eso pase, migrar de `text` a una estructura tipada es un ALTER TABLE
--     acotado, no un cambio de diseño de esta tabla. NO es un dato de salud del Art. 9 en
--     sí mismo (es una cadencia, no una condición médica) -- no está en la lista canónica
--     de PGM-3 y se deja sin cifrar a propósito, igual que `medical_contacts.notes`/
--     `emergency_contacts.notes` en PGM-21.
--   - RLS: aislado por familia vía subquery a `cared_persons` (idéntico patrón a
--     `medical_contacts`/`emergency_contacts` de PGM-21 -- dos tablas leyéndose entre sí,
--     ninguna recursiva).
--
-- ----------------------------------------------------------------------------------------
-- DISEÑO: `medication_logs`
-- ----------------------------------------------------------------------------------------
--   - `medication_id`: qué medicamento se dio (o no). on delete cascade -- si se borra el
--     medicamento, no tiene sentido conservar logs de tomas de un medicamento que ya no
--     existe (a diferencia de `shifts.cared_person_id`, acá no hay un caso de uso de
--     "conservar historial tras borrar el padre" para esta issue -- YAGNI; si aparece,
--     es un ALTER a `on delete set null` en una migración futura).
--   - `taken_by`: quién marcó la toma (auth.users). Mismo caso que `shifts.assigned_to`
--     en PGM-25: puede ser CUALQUIER miembro real de la familia dueña de la medicación,
--     no solo quien inserta el log (ej. un admin registra retroactivamente que otro
--     cuidador dio la medicación) -- se valida con `is_family_member()`, no con una FK
--     directa (no existe una FK auth.users->family_members que exprese "es miembro de
--     esta familia").
--   - `taken_at`: hora REAL en que se dio la medicación (no la programada/`schedule` de
--     `medications`) -- confirmación de toma en tiempo real, ver criterio de producto de
--     F4. NOT NULL, sin default: quien registra el log decide explícitamente el momento
--     (normalmente `now()` desde la app al tocar "dado", pero también debe poder
--     backdatearse si se registra una toma que ya pasó -- por eso no se fuerza `now()` acá
--     a nivel de columna).
--   - `note`: bytea cifrado, nullable (dato de salud -- lista canónica de PGM-3). Ej. "se
--     dio con el almuerzo", "rechazó la dosis completa".
--   - RLS: aislado por familia vía subquery a `medications` -> `cared_persons` (dos
--     niveles de indirección, mismo criterio no recursivo que las tablas hijas de PGM-21 --
--     cada policy lee de UNA tabla distinta a sí misma, nunca de `medication_logs`).

create table medications (
  id uuid primary key default gen_random_uuid(),
  cared_person_id uuid not null references cared_persons (id) on delete cascade,
  -- Datos de salud (RGPD art. 9): SIEMPRE cifrados. Ver
  -- supabase/migrations/20260913210000_encryption_helpers.sql, sección "CAMPOS DE SALUD A
  -- CIFRAR". Escribir con extensions.encrypt_text(text), leer con
  -- extensions.decrypt_text(bytea) -- nunca texto plano.
  name bytea not null,
  dose bytea not null,
  instructions bytea,
  -- Horario en texto libre -- ver nota de diseño (YAGNI) arriba de esta migración. NO es
  -- dato de salud del Art. 9 (es una cadencia, no una condición médica) -- sin cifrar a
  -- propósito.
  schedule text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table medications is
  'Medicamento de una cared_person: nombre, dosis, instrucciones (cifrados -- RGPD art. 9) '
  'y horario (texto libre, sin cifrar -- ver nota de diseño en esta migración). RLS aísla '
  'por family_id de la cared_person dueña, mismo patrón no recursivo que '
  'medical_contacts/emergency_contacts (PGM-21).';

comment on column medications.name is
  'Nombre del medicamento. Dato de salud (RGPD art. 9): SIEMPRE cifrado en reposo. '
  'Escribir con extensions.encrypt_text(text), leer con extensions.decrypt_text(bytea). '
  'Columna listada en la lista canónica de '
  'supabase/migrations/20260913210000_encryption_helpers.sql.';

comment on column medications.dose is
  'Dosis del medicamento (ej. "500mg", "2 comprimidos"). Dato de salud (RGPD art. 9): '
  'SIEMPRE cifrado en reposo -- mismo criterio que medications.name.';

comment on column medications.instructions is
  'Instrucciones especiales de administración (ej. "con el estómago lleno"). Dato de '
  'salud (RGPD art. 9): cifrado en reposo cuando está presente. Nullable: no todo '
  'medicamento requiere instrucciones especiales.';

comment on column medications.schedule is
  'Horario/cadencia en texto libre (ej. "cada 8 horas", "08:00, 14:00, 22:00"). Modelado '
  'como texto simple a propósito (YAGNI) -- ver nota de diseño extensa en esta migración '
  'sobre por qué no se estructura como time[]/scheduler en esta issue. NO es dato de '
  'salud del Art. 9 (es una cadencia, no una condición médica) -- sin cifrar.';

comment on column medications.created_by is
  'Usuario (miembro de la familia) que creó el registro del medicamento. on delete '
  'restrict, mismo criterio que created_by en families/cared_persons/shifts.';

create index medications_cared_person_id_idx on medications (cared_person_id);

create table medication_logs (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references medications (id) on delete cascade,
  -- Quién marcó la toma. Puede ser cualquier miembro real de la familia dueña del
  -- medicamento (no solo quien inserta el log) -- validado con is_family_member() en las
  -- policies de abajo, mismo caso que shifts.assigned_to en PGM-25.
  taken_by uuid not null references auth.users (id) on delete restrict,
  -- Hora REAL de la toma (no la programada en medications.schedule) -- confirmación de
  -- toma en tiempo real, ver criterio de producto de F4. Sin default: quien registra
  -- decide el momento explícitamente (normalmente now(), pero también debe poder
  -- backdatearse).
  taken_at timestamptz not null,
  -- Dato de salud (RGPD art. 9): cifrado en reposo cuando está presente.
  note bytea,
  created_at timestamptz not null default now()
);

comment on table medication_logs is
  'Registro de que se dio (o no) una toma de un medicamento: quién (taken_by), cuándo '
  '(taken_at, hora real) y nota (cifrada). RLS aísla por family_id de la medications -> '
  'cared_persons dueña, dos niveles de indirección no recursivos (mismo criterio que las '
  'tablas hijas de PGM-21/PGM-25).';

comment on column medication_logs.taken_by is
  'Usuario (auth.users) que marcó la toma. Debe ser miembro de la MISMA familia que el '
  'medicamento -- validado en las policies de INSERT/UPDATE vía is_family_member() '
  '(definida en 20260913230000_shifts.sql, PGM-25), no por una FK directa -- mismo caso '
  'que shifts.assigned_to. Puede ser distinto de quien ejecuta el INSERT (ej. un admin '
  'registra retroactivamente la toma de otro cuidador).';

comment on column medication_logs.taken_at is
  'Hora REAL en que se dio (o se rechazó) la medicación -- no la programada en '
  'medications.schedule. Ver criterio de producto de F4 (confirmación de toma en tiempo '
  'real). NOT NULL sin default: quien registra decide el momento explícitamente.';

comment on column medication_logs.note is
  'Nota libre sobre la toma (ej. "se dio con el almuerzo", "rechazó la dosis completa"). '
  'Dato de salud (RGPD art. 9): SIEMPRE cifrado en reposo cuando está presente. Escribir '
  'con extensions.encrypt_text(text), leer con extensions.decrypt_text(bytea). Columna '
  'listada en la lista canónica de '
  'supabase/migrations/20260913210000_encryption_helpers.sql.';

-- Índice compuesto (medication_id, taken_at): pensado para listar/ordenar el historial de
-- tomas de un medicamento por fecha (mismo criterio que shifts_family_id_starts_at_idx en
-- PGM-25, pensado para una futura vista de historial/calendario de medicación).
create index medication_logs_medication_id_taken_at_idx
  on medication_logs (medication_id, taken_at);

create index medication_logs_taken_by_idx on medication_logs (taken_by);

alter table medications enable row level security;
alter table medication_logs enable row level security;

-- medications: aísla por la family_id de la cared_person dueña. Subquery a cared_persons
-- (tabla distinta) -- no recursiva. Mismo patrón exacto que medical_contacts/
-- emergency_contacts en PGM-21.
create policy medications_select_member
  on medications for select
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy medications_insert_member
  on medications for insert
  with check (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy medications_update_member
  on medications for update
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  )
  with check (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy medications_delete_member
  on medications for delete
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

-- medication_logs: aísla por la family_id de la medications -> cared_persons dueña (dos
-- niveles de indirección). Además, INSERT/UPDATE validan que taken_by sea miembro REAL de
-- esa misma familia vía is_family_member() (PGM-25) -- mismo bug evitado que
-- shifts.assigned_to: una subquery directa a family_members para "¿es OTRO usuario
-- miembro?" quedaría sujeta a family_members_select_own y se reduciría silenciosamente a
-- taken_by = auth.uid(), rompiendo el caso "un admin registra la toma de otro cuidador".
create policy medication_logs_select_member
  on medication_logs for select
  using (
    medication_id in (
      select m.id from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy medication_logs_insert_member
  on medication_logs for insert
  with check (
    medication_id in (
      select m.id from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id in (select family_id from family_members where user_id = auth.uid())
    )
    and is_family_member(
      (
        select cp.family_id from medications m
        join cared_persons cp on cp.id = m.cared_person_id
        where m.id = medication_logs.medication_id
      ),
      taken_by
    )
  );

create policy medication_logs_update_member
  on medication_logs for update
  using (
    medication_id in (
      select m.id from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id in (select family_id from family_members where user_id = auth.uid())
    )
  )
  with check (
    medication_id in (
      select m.id from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id in (select family_id from family_members where user_id = auth.uid())
    )
    and is_family_member(
      (
        select cp.family_id from medications m
        join cared_persons cp on cp.id = m.cared_person_id
        where m.id = medication_logs.medication_id
      ),
      taken_by
    )
  );

create policy medication_logs_delete_member
  on medication_logs for delete
  using (
    medication_id in (
      select m.id from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );
