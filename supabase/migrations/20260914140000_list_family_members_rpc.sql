-- PGM-27: RPC mínima para poder armar un picker real de "asignar un turno a otro
-- cuidador" -- `list_family_members(p_family_id)`.
--
-- BLOQUEANTE QUE MOTIVA ESTA MIGRACIÓN (ver NOTES del agente para el detalle completo de
-- la decisión): para asignar un turno a OTRO cuidador de la familia (criterio de producto
-- #4, "reparto visible entre cuidadores") hace falta poder listar a los demás miembros de
-- la familia. Hoy eso no es posible desde el cliente: `family_members_select_own`
-- (20260913203000_families_and_members.sql, PGM-15) solo deja a cada usuario ver SU PROPIA
-- fila -- el mismo gap documentado en `src/features/shifts/assignedToLabel.ts` ("GAP DE
-- PRODUCTO: no existe todavía una tabla/vista de perfiles con nombre").
--
-- Esta función NO resuelve ese gap completo (no hay nombres reales, eso es PGM-20, "[FE]
-- Pantalla de perfil de cuidador", todavía Pendiente) -- solo expone lo mínimo indispensable
-- para poder ofrecer un picker de asignación: `user_id` (ya se resuelve a "Vos"/"Otro
-- cuidador (…XXXX)" en el cliente vía `assignedToLabel.ts`, igual que en el resto del
-- calendario) y `role` (admin/cuidador, útil para distinguir entradas en el picker sin
-- inventar un nombre).
--
-- DECISIÓN EXPLÍCITA: no se expone `email` de `auth.users`. Aunque coordinar turnos entre
-- miembros de una misma familia sería un caso defendible para mostrar el email, es un dato
-- personal adicional que esta issue no pidió explícitamente y que no hace falta para
-- resolver "asignar/reasignar un turno" -- el mismo criterio de identificador neutro que ya
-- usa `assignedToLabel.ts` alcanza. Preferimos el alcance más chico y auditable.
--
-- Mismo patrón `security definer` que `is_family_member()` (PGM-25,
-- 20260913230000_shifts.sql), y por la MISMA razón: bajo el rol `authenticated`, una
-- subquery directa a `family_members` para listar las filas de OTROS miembros se reduciría
-- a la fila propia (`family_members_select_own`). La diferencia con `is_family_member()` es
-- que esta función SÍ devuelve filas (no solo un boolean) -- por eso el guard de membresía
-- va DENTRO de la función (reutilizando `is_family_member()`, no duplicándolo) y se aplica
-- como filtro en el `where`, no como una verificación aparte: si el caller no es miembro de
-- `p_family_id`, la condición es `false` para todas las filas y el resultado es un conjunto
-- vacío -- nunca se filtra información de una familia ajena, ni siquiera "hay N miembros".
create or replace function public.list_family_members(p_family_id uuid)
returns table (
  user_id uuid,
  role text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select fm.user_id, fm.role
  from family_members fm
  where fm.family_id = p_family_id
    and is_family_member(p_family_id, auth.uid())
  order by fm.created_at asc;
$$;

comment on function public.list_family_members(uuid) is
  'PGM-27: lista (user_id, role) de los miembros de la familia p_family_id -- exclusivamente '
  'para poblar el picker de "asignar/reasignar turno a otro cuidador" (criterio de producto '
  '#4). security definer a propósito, mismo motivo que is_family_member() (PGM-25): bajo '
  'authenticated, una subquery directa a family_members para leer filas de OTROS usuarios '
  'se reduce a la fila propia por family_members_select_own. El guard de membresía '
  '(is_family_member(p_family_id, auth.uid())) vive DENTRO del where -- si el caller no es '
  'miembro de p_family_id, devuelve 0 filas, nunca filas de una familia ajena. No expone '
  'email ni ningún otro dato de auth.users -- decisión explícita, ver nota extensa arriba de '
  'esta función. Reemplazar/complementar cuando exista una tabla de perfiles real (PGM-20).';

revoke all on function public.list_family_members(uuid) from public;
grant execute on function public.list_family_members(uuid) to authenticated;
