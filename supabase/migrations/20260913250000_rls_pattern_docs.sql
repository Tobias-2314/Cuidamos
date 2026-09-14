-- PGM-4/T3: Base de RLS: aislamiento estricto por familia (patrón reutilizable para F1-F6)
--
-- CONTEXTO -- por qué esta migración no crea nada nuevo:
-- El helper `is_family_member(p_family_id uuid, p_user_id uuid)` que pedía PGM-4/T3 ya fue
-- implementado ad-hoc en PGM-25 (supabase/migrations/20260913230000_shifts.sql, líneas
-- ~88-154) para resolver un bug real de RLS recursiva, y ya se reusa sin duplicarse en
-- shifts (PGM-25) y medications/medication_logs (PGM-30). Esta migración NO recrea el
-- helper (sería `create or replace function` sobre una función idéntica, sin cambio de
-- comportamiento) -- solo formaliza su documentación como el patrón central y reutilizable
-- que debían dejar F1-F6, moviendo esa documentación de "dispersa en comentarios de cada
-- migración de feature" a un lugar único: el `comment on function` del propio helper, que
-- es lo que cualquier ingeniero va a mirar primero al encontrar `is_family_member()` en una
-- policy nueva (visible vía `\df+ is_family_member` / Supabase Studio / `pg_describe_object`
-- sin tener que rastrear qué migración de feature lo explica mejor).
--
-- `comment on function` es una operación independiente e idempotente (no es un ALTER de la
-- función en sí, no cambia su body/firma/permisos) -- se puede volver a ejecutar en una
-- migración nueva sin tocar la migración de PGM-25 ya aplicada, seguro para correr sobre una
-- base con datos existentes.

comment on function is_family_member(uuid, uuid) is
$rls_doc$PGM-25/PGM-4(T3): ¿el usuario p_user_id es miembro de la familia p_family_id?
security definer a propósito -- bypasea la RLS de family_members
(family_members_select_own solo deja ver la fila propia) para poder responder esta
pregunta sobre OTRO usuario. No expone filas de family_members al llamador, solo un
boolean. Motivado por un bug real encontrado en PGM-25: una subquery directa tipo
"assigned_to in (select user_id from family_members where family_id = ...)" queda ELLA
MISMA sujeta a family_members_select_own al ejecutarse bajo el rol authenticated, y se
reduce silenciosamente a "assigned_to = auth.uid()" -- ningún usuario podría asignar/
registrar algo a nombre de un compañero de familia real. Ver
supabase/migrations/20260913230000_shifts.sql para el detalle completo, verificado
empíricamente con una familia de dos miembros reales.

PATRÓN REUTILIZABLE DE RLS POR FAMILIA (PGM-4/T3) -- toda tabla nueva (F1-F6) con una
columna que aísla por familia debe seguir uno de estos tres casos. Ninguno es recursivo
(cada policy consulta una tabla DISTINTA de sí misma):

1) Tabla con family_id propio (caso más común, ej. cared_persons, shifts, medications):
   SELECT/DELETE usan
     using (family_id in (select family_id from family_members where user_id = auth.uid()))
   INSERT/UPDATE usan el mismo predicado en el "with check". Esta subquery NO es recursiva
   (consulta family_members, una tabla distinta) y alcanza para "¿SOY YO miembro de esta
   familia?" -- NO usar is_family_member() acá, sería innecesario (esa pregunta es sobre uno
   mismo, no sobre otro usuario).

2) Tabla con una columna que apunta a OTRO usuario que no es necesariamente quien ejecuta
   la operación (ej. shifts.assigned_to, medication_logs.taken_by): además del predicado del
   caso 1, el "with check" de INSERT/UPDATE debe agregar
     and is_family_member(<family_id de la fila>, <columna del otro usuario>)
   Es OBLIGATORIO usar is_family_member() en este caso específico -- una subquery directa a
   family_members para validar la membresía de OTRO usuario se rompe por el bug documentado
   arriba.

3) Tabla que referencia family_id indirectamente vía otra tabla (ej. medical_contacts/
   emergency_contacts vía cared_person_id -> cared_persons.family_id): filtrar con un "in" a
   la tabla intermedia, que a su vez ya filtra por membresía en su propia policy (ver
   supabase/migrations/20260913220000_cared_persons.sql) -- compone dos niveles no
   recursivos, misma seguridad que el caso 1 con un salto más de indirección.

Tests de referencia: supabase/tests/is_family_member.test.sql (PGM-4/T3 -- prueba el
helper en aislamiento, independiente de cualquier tabla de feature) y
supabase/tests/{rls_isolation,cared_persons,shifts,medications}.test.sql (aplicación
del patrón, un archivo por feature).$rls_doc$;
