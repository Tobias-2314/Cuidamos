-- PGM-backend: cierra el TODO dejado por PGM-20 en
-- src/features/family/careProfileService.ts -- no existía ninguna tabla `profiles` ni
-- columna de nombre/relación para un cuidador (la tabla `profiles` que mencionaba la
-- descripción original de PGM-5 nunca se había construido).
--
-- ============================================================================
-- DISEÑO: `profiles` -- extensión 1:1 de auth.users, NO de datos de salud
-- ============================================================================
--   - `user_id`: primary key Y foreign key a auth.users -- relación 1:1 estricta (un
--     usuario tiene a lo sumo un perfil), mismo criterio que `push_tokens` siendo
--     dueña por usuario en vez de por familia (PGM-10).
--   - `family_id`: nullable a propósito -- careProfileService.updateCareProfile() ya
--     puede invocarse con `familyResult.data` en null (ver ese archivo,
--     getCurrentUserFamilyId puede devolver null si el usuario todavía no tiene
--     familia) -- un usuario debería poder cargar su nombre antes de unirse a una
--     familia. `on delete set null` (no cascade): si la familia se borra
--     (delete_family_data, PGM-12), el perfil del usuario sigue existiendo -- borrar
--     una familia no borra la cuenta ni la identidad de sus miembros, mismo criterio
--     ya documentado en esa migración ("esta función nunca borra usuarios").
--   - `display_name` / `relation_to_cared_person`: texto libre, SIN cifrar. No son
--     datos de salud del art. 9 (confirmado en docs/product-vision.md) -- son
--     identidad/relación del cuidador, no del paciente. Nullable: un perfil puede
--     existir con uno solo, o ninguno, de los dos campos completados (mismo criterio
--     que shift_handovers, "algo es mejor que nada" en vez de exigir ambos).
--   - `updated_at`: se actualiza en cada upsert -- útil para saber si un cuidador
--     mantiene su perfil al día, sin necesidad de un historial completo (YAGNI, mismo
--     criterio que `reminder_sent_at` en shifts en vez de una tabla de eventos).
--
-- ============================================================================
-- RLS: dueño-only -- SIN lectura cruzada entre miembros de la familia (por ahora)
-- ============================================================================
-- Solo el propio usuario puede leer/escribir su fila (`user_id = auth.uid()`) -- mismo
-- patrón que `push_tokens_select_own` (PGM-10). PGM-20 dejó sugerido que
-- `display_name` (no `relation_to_cared_person`) debería ser legible por el resto de
-- la familia para reemplazar el stand-in de `assignedToLabel.ts` -- eso es una
-- decisión de producto/alcance DISTINTA (expone datos de un usuario a otros) y no se
-- resuelve acá: esta migración solo cubre el alcance exacto de PGM-20 ("guardar mi
-- propio nombre y relación"), no la lectura cruzada. Queda documentado como
-- ampliación futura, no inventado ni mezclado con esta issue.

create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  family_id uuid references families (id) on delete set null,
  display_name text,
  relation_to_cared_person text,
  updated_at timestamptz not null default now()
);

comment on table profiles is
  'PGM-backend (PGM-20): perfil de cuidador -- nombre y relación con la persona '
  'cuidada, extensión 1:1 de auth.users. Dueño-only por RLS (ver policies de esta '
  'migración) -- NO hay lectura cruzada entre miembros de la familia todavía (queda '
  'como ampliación futura sugerida por PGM-20 para reemplazar el stand-in de '
  'assignedToLabel.ts). display_name/relation_to_cared_person NO son datos de salud '
  'del art. 9 -- texto libre sin cifrar, a diferencia de condition_notes/medications/'
  'shift_handovers.';

comment on column profiles.family_id is
  'Familia actual del usuario al momento de guardar el perfil -- nullable (un usuario '
  'puede cargar su nombre antes de unirse a una familia) y `on delete set null` (no '
  'cascade): borrar una familia no borra el perfil de sus ex-miembros, mismo criterio '
  'que delete_family_data() nunca borra auth.users.';

comment on column profiles.display_name is
  'Nombre del cuidador tal como quiere que lo vean los demás miembros de su familia. '
  'Texto libre sin cifrar -- no es dato de salud del art. 9.';

comment on column profiles.relation_to_cared_person is
  'Relación del cuidador con la persona cuidada (ej. "Hija", "Cónyuge", "Cuidador '
  'contratado"). Texto libre sin cifrar -- no es dato de salud del art. 9.';

alter table profiles enable row level security;

create policy profiles_select_own
  on profiles for select
  using (user_id = auth.uid());

create policy profiles_insert_own
  on profiles for insert
  with check (user_id = auth.uid());

create policy profiles_update_own
  on profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy profiles_delete_own
  on profiles for delete
  using (user_id = auth.uid());

-- Sin `grant`/`revoke` explícitos de tabla -- mismo criterio que el resto del dominio
-- (families/shifts/medications): las 4 policies de arriba son la barrera real, los
-- grants base de Supabase para `authenticated` ya alcanzan (ver
-- 20260913203000_families_and_members.sql para el mismo criterio documentado).
