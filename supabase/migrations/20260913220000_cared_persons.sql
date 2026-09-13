-- PGM-21: Modelo de datos: cared_person, medical_contacts, emergency_contacts
--
-- F2 (persona cuidada + documentos). Datos de salud (categoría especial RGPD): cifrado en
-- reposo obligatorio en estas tablas, sobre la columna listada en la lista canónica de
-- supabase/migrations/20260913210000_encryption_helpers.sql (sección "CAMPOS DE SALUD A
-- CIFRAR"): `cared_persons.condition_notes`.
--
-- Reusa, sin reimplementar:
--   * PGM-15 (20260913203000_families_and_members.sql): patrón de aislamiento por familia
--     ad-hoc vía subquery a `family_members` (el helper `is_family_member()` de PGM-4/T3
--     todavía no existe). Acá el patrón se adapta un nivel: `cared_persons` filtra
--     directamente por `family_id in (select family_id from family_members where user_id =
--     auth.uid())` (igual que `families_select_member`), y `medical_contacts`/
--     `emergency_contacts` filtran por `cared_person_id in (select id from cared_persons
--     where <esa misma subquery>)` -- ninguna de las tres policies es recursiva porque cada
--     tabla solo lee de OTRA tabla distinta (`family_members` o `cared_persons`), nunca de
--     sí misma.
--   * PGM-3 (20260913210000_encryption_helpers.sql): `extensions.encrypt_text(text)` /
--     `extensions.decrypt_text(bytea)` para `condition_notes` (bytea en disco).
--
-- NOTA DE PRODUCTO -- consentimiento explícito (RGPD, ver docs/product-vision.md):
-- Se agrega `consent_given_at timestamptz` (nullable) en `cared_persons` para dejar el
-- modelo de datos listo, pero esta issue (PGM-21) NO implementa el flujo de consentimiento
-- en sí (validar que se dio, bloquear operaciones sin consentimiento, UI, etc.) -- eso es
-- PGM-24 ("[BE] Consentimiento explícito al crear el perfil"), que ya está en la cola. Se
-- eligió agregar la columna ahora (en vez de esperar a PGM-24) para evitar una migración de
-- ALTER TABLE separada solo para eso, dado que es un campo simple sin lógica asociada
-- todavía. PGM-24 es responsable de: decidir si `consent_given_at` debe ser NOT NULL a
-- futuro, agregar validación a nivel de aplicación/trigger de que no se opera sobre una
-- `cared_person` sin consentimiento, y cualquier UI/flujo de captura. Ver NOTES del agente
-- para más detalle.
--
-- NOTA DE ALCANCE -- medical_contacts / emergency_contacts sin cifrar:
-- Según la lista canónica de PGM-3, estas dos tablas NO están en el listado de campos a
-- cifrar -- son contactos (nombre, teléfono, relación/especialidad), no notas de salud en
-- sí. Se agrega igual una columna `notes` de texto libre en cada una (útil en la práctica:
-- "solo llamar en horario de mañana", "es el médico de cabecera desde 2020") pero SIN
-- cifrar, porque no calificaría como dato de salud del Art. 9 salvo que alguien escriba
-- ahí una nota clínica por error. Se documenta explícitamente en el comment de columna para
-- que quede claro el criterio y no se use como bypass de la lista canónica.

create table cared_persons (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) > 0),
  birth_date date,
  -- Dato de salud (RGPD art. 9): NUNCA texto plano. Se escribe con
  -- extensions.encrypt_text(text) y se lee con extensions.decrypt_text(bytea) -- ver PGM-3.
  condition_notes bytea,
  -- RGPD: consentimiento explícito al crear el perfil. Columna agregada en esta issue,
  -- flujo/validación de captura en PGM-24 -- ver nota de producto arriba.
  consent_given_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table cared_persons is
  'Persona cuidada (dependiente) de una familia. Contiene datos de salud especiales '
  '(condition_notes, cifrado) -- RGPD art. 9. RLS aísla por family_id siguiendo el patrón '
  'ad-hoc de PGM-15 (subquery a family_members, no recursiva).';

comment on column cared_persons.condition_notes is
  'Notas de condición/salud de la persona cuidada. Dato de salud (RGPD art. 9): SIEMPRE '
  'cifrado en reposo. Escribir con extensions.encrypt_text(text), leer con '
  'extensions.decrypt_text(bytea) -- nunca guardar/leer texto plano acá. Columna listada en '
  'la lista canónica de supabase/migrations/20260913210000_encryption_helpers.sql.';

comment on column cared_persons.consent_given_at is
  'Timestamp del consentimiento explícito (RGPD) para tratar los datos de esta persona '
  'cuidada. Columna agregada en PGM-21; el flujo de captura/validación (bloquear '
  'operaciones sin consentimiento, UI) es responsabilidad de PGM-24 -- NO implementado acá. '
  'Nullable a propósito hasta que PGM-24 decida si/cuándo se vuelve NOT NULL.';

comment on column cared_persons.created_by is
  'Usuario (miembro de la familia) que creó el perfil. on delete restrict, mismo criterio '
  'que families.created_by en PGM-15 -- ver esa migración para el detalle de la decisión.';

create index cared_persons_family_id_idx on cared_persons (family_id);

create table medical_contacts (
  id uuid primary key default gen_random_uuid(),
  cared_person_id uuid not null references cared_persons (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) > 0),
  specialty text,
  phone text,
  -- Texto libre SIN cifrar -- ver nota de alcance arriba (no está en la lista canónica de
  -- PGM-3). No usar este campo para volcar notas clínicas/de salud de la persona cuidada.
  notes text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table medical_contacts is
  'Médico/profesional de salud de una cared_person (nombre, especialidad, teléfono). No '
  'contiene datos de salud en sí -- no requiere cifrado (ver lista canónica de PGM-3). RLS '
  'aísla por family_id de la cared_person dueña, vía subquery no recursiva a cared_persons.';

comment on column medical_contacts.notes is
  'Nota libre sobre el contacto (ej. horario de atención). SIN cifrar a propósito -- no '
  'calificó como dato de salud del Art. 9 en la lista canónica de PGM-3. No usar para notas '
  'clínicas/de salud de la persona cuidada -- eso va en cared_persons.condition_notes.';

create index medical_contacts_cared_person_id_idx on medical_contacts (cared_person_id);

create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  cared_person_id uuid not null references cared_persons (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) > 0),
  relationship text,
  phone text not null check (char_length(trim(phone)) > 0),
  notes text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table emergency_contacts is
  'Contacto de emergencia de una cared_person (nombre, relación, teléfono). No contiene '
  'datos de salud en sí -- no requiere cifrado (ver lista canónica de PGM-3). RLS aísla por '
  'family_id de la cared_person dueña, vía subquery no recursiva a cared_persons.';

comment on column emergency_contacts.notes is
  'Nota libre sobre el contacto de emergencia. SIN cifrar -- mismo criterio que '
  'medical_contacts.notes (ver comment de esa columna).';

comment on column emergency_contacts.phone is
  'Teléfono de contacto. NOT NULL: a diferencia de medical_contacts, un contacto de '
  'emergencia sin teléfono no cumple su propósito.';

create index emergency_contacts_cared_person_id_idx on emergency_contacts (cared_person_id);

alter table cared_persons enable row level security;
alter table medical_contacts enable row level security;
alter table emergency_contacts enable row level security;

-- cared_persons: un usuario ve/opera sobre las cared_persons de las familias de las que es
-- miembro. Mismo patrón no-recursivo que families_select_member (PGM-15): esta policy
-- consulta family_members, una tabla distinta.
create policy cared_persons_select_member
  on cared_persons for select
  using (
    family_id in (select family_id from family_members where user_id = auth.uid())
  );

create policy cared_persons_insert_member
  on cared_persons for insert
  with check (
    family_id in (select family_id from family_members where user_id = auth.uid())
  );

create policy cared_persons_update_member
  on cared_persons for update
  using (
    family_id in (select family_id from family_members where user_id = auth.uid())
  )
  with check (
    family_id in (select family_id from family_members where user_id = auth.uid())
  );

create policy cared_persons_delete_member
  on cared_persons for delete
  using (
    family_id in (select family_id from family_members where user_id = auth.uid())
  );

-- medical_contacts / emergency_contacts: aíslan por la family_id de la cared_person dueña.
-- La subquery lee de `cared_persons`, una tabla distinta -- no es recursiva. `cared_persons`
-- a su vez ya filtra por membresía en su propia policy, así que esto compone dos niveles no
-- recursivos (igual de seguro, solo un salto más de indirección que families/family_members).
create policy medical_contacts_select_member
  on medical_contacts for select
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy medical_contacts_insert_member
  on medical_contacts for insert
  with check (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy medical_contacts_update_member
  on medical_contacts for update
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

create policy medical_contacts_delete_member
  on medical_contacts for delete
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy emergency_contacts_select_member
  on emergency_contacts for select
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy emergency_contacts_insert_member
  on emergency_contacts for insert
  with check (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy emergency_contacts_update_member
  on emergency_contacts for update
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

create policy emergency_contacts_delete_member
  on emergency_contacts for delete
  using (
    cared_person_id in (
      select id from cared_persons
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );
