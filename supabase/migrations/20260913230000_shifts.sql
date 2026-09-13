-- PGM-25: Modelo de datos: shifts (turno, cuidador asignado, rango horario, estado)
--
-- F3 (calendario de turnos). Criterio de producto #4 ("¿Es visible el reparto entre
-- cuidadores?"): repartir turnos entre varios cuidadores de una misma familia es un
-- diferenciador central del producto, no secundario -- por eso `shifts.assigned_to`
-- necesita poder apuntar a CUALQUIER miembro legítimo de la familia (no solo a quien
-- crea el turno). Esa necesidad es la que motiva el helper `is_family_member()` de más
-- abajo -- ver la nota extensa antes de su definición.
--
-- Reusa, sin reimplementar:
--   * PGM-15 (20260913203000_families_and_members.sql): tabla `family_members` (relación
--     usuario-familia con rol).
--   * PGM-21 (20260913220000_cared_persons.sql): tabla `cared_persons` y el patrón de
--     aislamiento por family_id vía subquery no recursiva a `family_members`.
--
-- Diseño de `shifts`:
--   - `family_id`: familia dueña del turno (aísla por familia, mismo patrón que las demás
--     tablas de este dominio).
--   - `cared_person_id`: persona cuidada durante el turno (nullable -- un turno podría no
--     estar atado a una persona cuidada específica todavía, p.ej. si una familia coordina
--     turnos generales antes de cargar el perfil de la persona cuidada; PGM-21 ya existe,
--     así que en el flujo normal debería completarse, pero no lo forzamos NOT NULL acá por
--     no tener un caso de uso confirmado que lo requiera -- YAGNI).
--   - `assigned_to`: cuidador (auth.users) asignado al turno. Puede ser cualquier miembro
--     de la familia (admin o cuidador), no solo quien crea el turno -- es el corazón del
--     "reparto entre cuidadores" del criterio de producto #4.
--   - `starts_at` / `ends_at`: rango horario del turno, con check `ends_at > starts_at`.
--   - `status`: estado del turno (`scheduled`, `in_progress`, `completed`, `cancelled`).
--   - índice compuesto `(family_id, starts_at)`: pensado para PGM-28 (vista de calendario
--     que va a listar/ordenar turnos de una familia por rango de fechas).

create table shifts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  -- Nullable a propósito: ver nota de diseño arriba (no todo turno tiene todavía una
  -- cared_person cargada). on delete set null: si se borra la cared_person, el turno no
  -- debería desaparecer (perdería el registro de quién cuidó cuándo), solo pierde el
  -- vínculo.
  cared_person_id uuid references cared_persons (id) on delete set null,
  assigned_to uuid not null references auth.users (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

comment on table shifts is
  'Turno de cuidado: cuidador asignado, rango horario y estado. RLS aísla por family_id '
  'siguiendo el patrón no recursivo de PGM-15/PGM-21. assigned_to puede ser cualquier '
  'miembro de la familia (no solo quien crea el turno) -- ver is_family_member() más abajo '
  'y criterio de producto #4 (reparto visible entre cuidadores).';

comment on column shifts.cared_person_id is
  'Persona cuidada durante el turno. Nullable: un turno puede crearse sin una cared_person '
  'específica todavía. on delete set null: borrar la cared_person no borra el historial de '
  'turnos, solo el vínculo.';

comment on column shifts.assigned_to is
  'Cuidador (auth.users) asignado a este turno. Debe ser miembro de la MISMA familia que '
  'el turno (family_id) -- validado en las policies de INSERT/UPDATE vía '
  'is_family_member(), no por una FK (no hay una FK directa auth.users->family_members '
  'que exprese "es miembro de esta familia").';

comment on column shifts.status is
  'Estado del turno: scheduled (agendado, default), in_progress (en curso), completed '
  '(finalizado), cancelled (cancelado). Sin transición de estados validada a nivel de DB '
  'en esta issue -- eso queda para cuando exista lógica de negocio explícita sobre el '
  'ciclo de vida del turno (fuera de alcance de PGM-25).';

comment on column shifts.created_by is
  'Usuario (miembro de la familia) que creó el turno. on delete restrict, mismo criterio '
  'que families.created_by/cared_persons.created_by (ver PGM-15).';

-- Índice compuesto (family_id, starts_at): pensado para PGM-28 (vista de calendario),
-- que va a filtrar por familia y ordenar/rangear por fecha de inicio.
create index shifts_family_id_starts_at_idx on shifts (family_id, starts_at);

-- Índice adicional por cared_person_id: útil para consultar el historial de turnos de una
-- persona cuidada en particular, independiente del filtro de calendario por familia.
create index shifts_cared_person_id_idx on shifts (cared_person_id);

alter table shifts enable row level security;

-- ============================================================================
-- is_family_member(): helper security definer
-- ============================================================================
--
-- POR QUÉ HACE FALTA (bug encontrado y corregido en el reintento de esta issue, verificado
-- empíricamente):
--
-- La validación "¿assigned_to es miembro de esta familia?" NO se puede resolver con una
-- subquery directa a `family_members` bajo RLS, a diferencia de la validación "¿SOY YO
-- miembro de esta familia?" que sí funciona así (ver cared_persons_insert_member en
-- PGM-21, que hace `family_id in (select family_id from family_members where user_id =
-- auth.uid())` -- ESE caso es seguro).
--
-- La diferencia: `family_members` (PGM-15) tiene la policy `family_members_select_own`,
-- `using (user_id = auth.uid())` -- cada usuario SOLO puede leer su PROPIA fila de
-- family_members, nunca las de sus compañeros. Una policy de `shifts` corriendo bajo el
-- rol `authenticated` que intentara escribir:
--
--   and assigned_to in (select user_id from family_members where family_id = shifts.family_id)
--
-- queda ELLA MISMA sujeta a esa RLS de `family_members` al ejecutarse (no hay ningún
-- `security definer` de por medio): la subquery devuelve como mucho la fila del usuario
-- que hace la consulta (quien ejecuta el INSERT/UPDATE), nunca la de un compañero.
-- Resultado en la práctica: `assigned_to in (...)` se reduce a `assigned_to = auth.uid()`
-- para cualquier usuario -- NINGÚN usuario podría asignar un turno a un compañero de
-- familia, solo a sí mismo, aunque ese compañero sea un miembro legítimo. Esto se verificó
-- empíricamente con una familia de dos miembros reales (admin + cuidador): logueado como
-- el admin, un INSERT de un shift con assigned_to = el otro miembro era rechazado con
-- insufficient_privilege pese a ser un miembro legítimo -- justo el caso central del
-- criterio de producto #4 (reparto de turnos entre cuidadores), roto por este bug.
--
-- La solución es un helper `security definer` que bypasea la RLS de `family_members` SOLO
-- para responder la pregunta acotada "¿el usuario p_user_id es miembro de la familia
-- p_family_id?" -- no expone ninguna fila de family_members al llamador, solo un boolean.
-- Es un caso distinto (y legítimo) de necesitar `security definer`: la pregunta es sobre
-- la membresía de OTRO usuario, no sobre la propia fila de quien ejecuta la consulta.
--
-- NOTA DE ALCANCE: esta función es una versión acotada, creada para lo que PGM-25
-- necesita, del helper reutilizable `is_family_member()` formal que debía entregar
-- PGM-4/T3 (mencionado como dependencia pendiente en los comentarios de PGM-15/PGM-21) y
-- que esa issue todavía no entregó. Cuando se implemente PGM-4/T3, evaluar si esta función
-- se consolida/mueve a esa migración (o si PGM-4/T3 simplemente reutiliza esta, si la
-- firma le sirve) en vez de duplicar el helper.
create or replace function is_family_member(p_family_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from family_members
    where family_id = p_family_id and user_id = p_user_id
  );
$$;

comment on function is_family_member(uuid, uuid) is
  'PGM-25: ¿el usuario p_user_id es miembro de la familia p_family_id? security definer '
  'a propósito -- bypasea la RLS de family_members (family_members_select_own solo deja '
  'ver la fila propia) para poder responder esta pregunta sobre OTRO usuario, que es lo '
  'que necesitan las policies de shifts al validar assigned_to. Ver nota extensa arriba de '
  'esta función para el detalle completo del bug que motivó este helper. No expone filas '
  'de family_members al llamador, solo un boolean. Versión acotada del helper reutilizable '
  'que debía entregar PGM-4/T3 -- candidata a consolidarse ahí cuando esa issue se '
  'implemente.';

revoke all on function is_family_member(uuid, uuid) from public;
grant execute on function is_family_member(uuid, uuid) to authenticated, service_role;

-- shifts: un usuario ve los turnos de las familias de las que es miembro. Mismo patrón no
-- recursivo que cared_persons_select_member (PGM-21): esta policy consulta
-- family_members, una tabla distinta, filtrando por la propia fila (auth.uid()) -- no
-- necesita is_family_member() porque no está preguntando por OTRO usuario.
create policy shifts_select_member
  on shifts for select
  using (
    family_id in (select family_id from family_members where user_id = auth.uid())
  );

-- shifts: INSERT solo si (a) quien inserta es miembro de la familia del turno, y (b)
-- assigned_to es también miembro de esa misma familia (vía is_family_member(), por el bug
-- documentado arriba) y, si se especifica cared_person_id, pertenece a esa misma familia.
create policy shifts_insert_member
  on shifts for insert
  with check (
    family_id in (select family_id from family_members where user_id = auth.uid())
    and is_family_member(shifts.family_id, assigned_to)
    and (
      cared_person_id is null
      or cared_person_id in (select id from cared_persons where family_id = shifts.family_id)
    )
  );

-- shifts: UPDATE con las mismas tres condiciones que INSERT, aplicadas tanto a la fila
-- vieja (using) como a la nueva (with check) -- para que no se pueda "mover" un turno
-- fuera de la familia ni reasignarlo a alguien que no sea miembro.
create policy shifts_update_member
  on shifts for update
  using (
    family_id in (select family_id from family_members where user_id = auth.uid())
  )
  with check (
    family_id in (select family_id from family_members where user_id = auth.uid())
    and is_family_member(shifts.family_id, assigned_to)
    and (
      cared_person_id is null
      or cared_person_id in (select id from cared_persons where family_id = shifts.family_id)
    )
  );

-- shifts: un usuario puede borrar únicamente turnos de una familia de la que es miembro.
create policy shifts_delete_member
  on shifts for delete
  using (
    family_id in (select family_id from family_members where user_id = auth.uid())
  );
