-- PGM-15: Modelo de datos: familias, usuarios, roles
-- Crea `families` y `family_members` (relación usuario-familia con rol admin/cuidador)
-- con RLS habilitado desde el día uno. RGPD: solo miembros de la propia familia pueden
-- leer/escribir sus datos.
--
-- NOTA DE DISEÑO (aprobado por Tech Lead, no depende de PGM-4/T3):
-- La policy "obvia" para que un cuidador vea a sus compañeros de familia sería algo como
-- `using (family_id in (select family_id from family_members where user_id = auth.uid()))`
-- en la propia tabla `family_members`. Esa policy es RECURSIVA (la tabla se consulta a sí
-- misma dentro de su propia RLS) y Postgres la rechaza o la evalúa de forma costosa/inestable
-- según el caso. Resolverla bien requiere un helper `security definer` tipo
-- `is_family_member(family_id uuid)` que se cree en PGM-4/T3 (ya scaffoldeado en el backlog).
--
-- Para no bloquear esta issue en esa dependencia, el approach acá es más conservador:
--   - Cada usuario únicamente puede ver/borrar SU PROPIA fila en `family_members`
--     (`user_id = auth.uid()`), nunca las de sus compañeros de familia.
--   - Solo se puede insertar una fila de `family_members` para uno mismo, y solo si uno
--     mismo es quien creó la familia (`families.created_by = auth.uid()`). Esto alcanza
--     para el flujo "creo mi familia y quedo de admin", pero NO permite invitar a otro
--     cuidador todavía (ver NOTES del agente para el detalle de esa limitación conocida).
--   - `families` sí puede filtrar por membresía vía subquery a `family_members`, porque esa
--     subquery no es recursiva (una tabla distinta) y ya queda acotada a `auth.uid()` por
--     las policies propias de `family_members`.

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  -- on delete restrict: evita borrar una cuenta de auth.users mientras siga siendo
  -- dueña de una familia (con o sin otros miembros). Todavía no existe una feature de
  -- "baja de cuenta" en el producto; cuando se implemente, esta FK va a requerir que se
  -- transfiera la titularidad de la familia (o se borre explícitamente) antes de poder
  -- borrar al usuario. Decisión explícita: preferimos bloquear el delete antes que
  -- arrastrar en cascada la familia entera (y las membresías de otros cuidadores) como
  -- efecto secundario silencioso de borrar una cuenta.
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table families is
  'Grupo familiar que coordina el cuidado de una o más personas dependientes.';
comment on column families.created_by is
  'Usuario que creó la familia. on delete restrict: ver nota de diseño en esta migración '
  '— pendiente de revisar cuando exista baja de cuenta.';

create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'cuidador')),
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

comment on table family_members is
  'Relación usuario-familia con rol (admin/cuidador). RLS restringe cada usuario a ver '
  'únicamente su propia fila — ver nota de diseño en esta migración sobre por qué no '
  'expone todavía a los compañeros de familia (depende de PGM-4/T3).';

create index family_members_user_id_idx on family_members (user_id);

alter table families enable row level security;
alter table family_members enable row level security;

-- families: un usuario ve las familias de las que es miembro (según su propia fila en
-- family_members, la única que puede ver).
create policy families_select_member
  on families for select
  using (
    id in (select family_id from family_members where user_id = auth.uid())
  );

-- families: cualquier usuario autenticado puede crear una familia de la que él mismo
-- queda como creador.
create policy families_insert_own
  on families for insert
  with check (created_by = auth.uid());

-- families: solo quien creó la familia puede borrarla.
create policy families_delete_own
  on families for delete
  using (created_by = auth.uid());

-- No hay policy de UPDATE en `families` en esta issue (no hay caso de uso todavía, p.ej.
-- renombrar la familia) — sin policy, RLS deniega todo UPDATE por defecto.

-- family_members: cada usuario solo puede ver su propia fila de membresía.
create policy family_members_select_own
  on family_members for select
  using (user_id = auth.uid());

-- family_members: un usuario solo puede insertar una fila para sí mismo, y solo cuando
-- es quien creó la familia (flujo "creo mi familia, quedo de admin"). No permite todavía
-- que un admin invite a otro cuidador (user_id de otra persona) — eso queda para cuando
-- exista el helper is_family_member()/una policy de invitación explícita (PGM-4 y una
-- issue de invitación de cuidadores, ver NOTES).
create policy family_members_insert_self_as_creator
  on family_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from families f
      where f.id = family_id and f.created_by = auth.uid()
    )
  );

-- family_members: un usuario puede borrar (abandonar) únicamente su propia membresía.
create policy family_members_delete_own
  on family_members for delete
  using (user_id = auth.uid());

-- No hay policy de UPDATE en `family_members` en esta issue (cambiar de rol a un
-- compañero de familia requiere el mismo helper que la invitación) — sin policy, RLS
-- deniega todo UPDATE por defecto.
