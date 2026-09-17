-- BUG REAL: crear una familia rompía con 403 (42501, "new row violates
-- row-level security policy for table \"families\"") pese a que la policy
-- `families_insert_own` (`created_by = auth.uid()`) es correcta y su
-- condición evaluaba TRUE.
--
-- La causa no era el INSERT en sí: `familyService.createFamily()` hace
-- `.insert(...).select('id, name').single()`, que PostgREST traduce a
-- `INSERT ... RETURNING id, name`. Postgres aplica la policy de SELECT de
-- la tabla a las filas devueltas por un RETURNING -- y `families_select_member`
-- exigía que el usuario YA fuera miembro de la familia (`id in (select
-- family_id from family_members where user_id = auth.uid())`), lo cual es
-- imposible en el instante de crearla: todavía no existe la fila de
-- family_members (esa es literalmente la siguiente sentencia del flujo).
-- Círculo imposible de romper para el primer insert -- reproducido y
-- confirmado en una transacción de prueba (ver sesión de debugging) antes
-- de este fix: sin RETURNING el insert funciona, con RETURNING falla
-- exactamente en el paso de visibilidad, no en el WITH CHECK del insert.
--
-- Fix: el creador de una familia siempre puede verla, incluso antes de
-- tener su propia fila en family_members (que se crea en el paso
-- siguiente del mismo flujo). No afloja seguridad real -- `created_by`
-- solo lo puede setear el propio usuario (`families_insert_own`), así que
-- esto solo le da visibilidad de las familias que ÉL mismo creó.
drop policy families_select_member on families;

create policy families_select_member
  on families for select
  using (
    created_by = auth.uid()
    or id in (select family_id from family_members where user_id = auth.uid())
  );
