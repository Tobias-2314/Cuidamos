-- PGM-35: Modelo de datos: shift_handovers (turno, resumen, comida, ánimo, pendientes)
--
-- F5 (traspaso de turno). Criterio de producto no negociable: "Traspaso de turno < 30
-- segundos: máximo 4 campos, escritura mínima" -- cero fricción, tipo "diario de guardia"
-- entre cuidadores. Esta issue es SOLO el modelo de datos (tabla + cifrado + RLS): el
-- formulario de cierre de turno y la vista de "último traspaso" son issues de Frontend
-- futuras, y las RPCs de lectura/escritura (necesarias porque TODOS los campos de
-- contenido van cifrados, ver más abajo) son issues de Backend futuras -- mismo patrón que
-- PGM-21 (modelo) -> PGM-22/23 (RPC/UI) y PGM-30 (modelo) -> PGM-31/32/33 (RPC/UI) para
-- medications. NO se construye nada de eso acá.
--
-- ----------------------------------------------------------------------------------------
-- NOTA DE NOMENCLATURA -- `shift_handovers` (no `shift_handoffs`)
-- ----------------------------------------------------------------------------------------
-- El título de la issue PGM-35 dice "shift_handoffs" (con "off"), pero la lista canónica de
-- campos a cifrar (PGM-3, supabase/migrations/20260913210000_encryption_helpers.sql, sección
-- "CAMPOS DE SALUD A CIFRAR", escrita antes en PGM-3/T2) usa "shift_handovers" (con "over"):
--
--   * shift_handovers.* (todos los campos de texto libre de esa tabla: resumen del cambio
--     de turno, observaciones abiertas sobre la persona cuidada, o cualquier otro campo de
--     texto libre que F5 termine definiendo en esa tabla) -- F5
--
-- Es una inconsistencia de nomenclatura entre dos documentos del proyecto, no un typo de
-- esta migración. Se usa acá "shift_handovers" -- el nombre de la lista canónica, que es la
-- fuente de verdad explícitamente diseñada para que F2/F4/F5 la sigan -- para que la
-- referencia cruzada de PGM-3 quede consistente con el nombre real de la tabla. Si algún
-- documento/issue futuro usa "shift_handoffs", es el mismo objeto: esta tabla.
--
-- ----------------------------------------------------------------------------------------
-- CIFRADO -- patrón NUEVO en este proyecto: 100% de las columnas de contenido cifradas
-- ----------------------------------------------------------------------------------------
-- A diferencia de cared_persons (solo condition_notes) o medications/medication_logs (name,
-- dose, instructions, note -- pero no schedule/taken_at), la lista canónica de PGM-3 dice
-- explícitamente "TODOS los campos de texto libre" de esta tabla. Los 4 campos de contenido
-- de la descripción de la issue (resumen, comida, ánimo, pendientes) van TODOS `bytea`,
-- cifrados con extensions.encrypt_text(text) / leídos con extensions.decrypt_text(bytea) --
-- ver PGM-3. Ninguno se guarda en texto plano.
--
-- Motivo de negocio: un traspaso de turno es, en esencia, una nota de observación libre
-- sobre la persona cuidada (estado de ánimo, qué comió, pendientes de cuidado) escrita por
-- un cuidador para el siguiente -- es dato de salud/cuidado personal (RGPD art. 9) de punta
-- a punta, no solo en un campo aislado como `condition_notes`.
--
-- Como consecuencia, cualquier lectura/escritura futura de esta tabla va a necesitar RPCs
-- `security definer` que cifren/descifren server-side (mismo bloqueante técnico que
-- medications: un INSERT/SELECT directo bajo el rol `authenticated` no puede popular/leer
-- columnas bytea con texto plano cifrado correctamente sin pasar por
-- extensions.encrypt_text/decrypt_text, que no están expuestas via PostgREST sobre columnas
-- arbitrarias del cliente) -- pero construir esas RPCs NO es alcance de esta issue.
--
-- ----------------------------------------------------------------------------------------
-- DISEÑO: `shift_handovers`
-- ----------------------------------------------------------------------------------------
--   - `shift_id`: turno que se está cerrando. FK a `shifts` (PGM-25,
--     20260913230000_shifts.sql). on delete cascade -- un traspaso documenta el cierre de
--     UN turno específico; si el turno se borra, el traspaso pierde su razón de ser (mismo
--     criterio que medical_contacts/emergency_contacts -> cared_persons en PGM-21).
--   - `family_id` NO se duplica en esta tabla: se resuelve indirectamente vía
--     `shifts.family_id`, mismo patrón de dos niveles de indirección no recursiva que
--     `medical_contacts`/`emergency_contacts` -> `cared_persons` (PGM-21) o
--     `medication_logs` -> `medications` -> `cared_persons` (PGM-30). No hay una razón
--     concreta para duplicarla acá (no hay un caso de uso de "traspaso sin turno" ni de
--     reasignar un traspaso a otra familia) -- YAGNI. Si en el futuro aparece un caso real
--     que lo justifique, es un ALTER TABLE + backfill, no un cambio de diseño de esta tabla.
--   - `shift_id` es UNIQUE: se modela como una relación 1:1 con `shifts` -- "el" traspaso de
--     cierre de ESE turno, no un log de múltiples entradas por turno (a diferencia de
--     `medication_logs`, que sí es un log de múltiples tomas por medicamento). Si el
--     cuidador se equivoca, el flujo esperado es actualizar (UPDATE) el traspaso existente,
--     no insertar uno nuevo -- de ahí la policy de UPDATE más abajo. Si en el futuro F5
--     necesita múltiples traspasos por turno (ej. notas incrementales durante el turno, no
--     solo al cierre), esta constraint se saca en una migración futura -- no hay caso de uso
--     confirmado hoy (YAGNI).
--   - `resumen` / `comida` / `pendientes`: texto libre, todos `bytea` cifrados (ver arriba).
--     Los 3 nullable: el criterio de producto pide "escritura mínima" -- un cuidador con
--     poco tiempo debería poder cerrar el turno sin completar los 4 campos. No se agrega un
--     CHECK "al menos un campo no nulo" en esta issue -- no hay una decisión de producto
--     confirmada sobre si un traspaso completamente vacío es válido; queda para que la
--     issue de RPC/UI (que sí conoce el flujo real del formulario) decida y, si hace falta,
--     agregue esa validación (a nivel de RPC o de constraint) en su propia migración.
--   - `animo` (sin tilde -- identificador SQL sin comillas, ver nota abajo): DECISIÓN DE
--     DISEÑO -- se modela como texto libre (`bytea` cifrado), igual que los otros 3 campos,
--     en vez de una escala/enum estructurado (ej. 'bien'/'regular'/'mal' o 1-5). Se evaluó
--     la alternativa estructurada porque encajaría mejor con "máximo 4 campos, escritura
--     mínima" (un selector de 3-5 opciones es más rápido que escribir texto) y evitaría
--     cifrar un dato de baja cardinalidad. Se elige texto libre en esta issue por tres
--     razones: (1) la lista canónica de PGM-3 dice "TODOS los campos de texto libre" de esta
--     tabla van cifrados -- tratar `animo` como texto libre mantiene el diseño 100%
--     consistente con esa directiva sin tener que decidir ahora una taxonomía de valores
--     que no está definida en ningún documento de producto; (2) esta issue es solo el
--     modelo de datos, y la UI real (F5, issue futura de Frontend) es quien mejor sabe si un
--     selector de 3-5 chips cierra el <30s del criterio de producto mejor que un input de
--     texto corto -- decidir el enum acá sin esa referencia sería inventar producto; (3) si
--     F5 termina queriendo una escala estructurada, migrar de `bytea` (texto libre cifrado)
--     a un `text`/enum sin cifrar es un ALTER TABLE acotado (y de hecho simplifica el
--     modelo, no lo complica) -- el camino inverso (de estructurado a texto libre) sería más
--     costoso. Documentado acá para que la issue de RPC/UI de F5 lo revise explícitamente y,
--     si decide una escala estructurada, lo cambie con conocimiento de causa.
--   - `created_by` / `created_at`: mismo patrón que el resto de las tablas de este dominio
--     (families/cared_persons/shifts/medications) -- quien registra el traspaso es quien
--     cierra el turno; no hay necesidad de validar la membresía de OTRO usuario (a
--     diferencia de `shifts.assigned_to`/`medication_logs.taken_by`), así que NO hace falta
--     `is_family_member()` acá.
--
-- NOTA -- identificador `animo` sin tilde: Postgres soporta identificadores con tildes solo
-- entre comillas dobles (`"ánimo"`), lo que obliga a citar la columna en TODA query futura
-- (RPCs, joins, migraciones) y es una fuente común de errores silenciosos si alguna
-- referencia olvida las comillas. Se usa `animo` (ASCII, sin comillas) siguiendo la
-- convención del resto del esquema (ningún identificador de este proyecto usa tildes) --
-- puramente un nombre de columna interno, no user-facing (la UI de F5 puede mostrar el
-- label "Ánimo" con tilde sin que eso tenga relación con el nombre de la columna).
--
-- Reusa, sin reimplementar:
--   * PGM-25 (20260913230000_shifts.sql): tabla `shifts` y el patrón de RLS por family_id.
--   * PGM-21 (20260913220000_cared_persons.sql): patrón de RLS con subquery a una tabla
--     padre para tablas hijas sin family_id propio (mismo patrón que medical_contacts/
--     emergency_contacts, aplicado acá con `shifts` como padre en vez de `cared_persons`).
--   * PGM-3 (20260913210000_encryption_helpers.sql): extensions.encrypt_text(text) /
--     extensions.decrypt_text(bytea) -- documentado acá para las futuras RPCs de F5, NO
--     usado directamente en esta migración (no hay RPC en este alcance).

create table shift_handovers (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references shifts (id) on delete cascade,
  -- Datos de salud/cuidado (RGPD art. 9): TODOS cifrados -- ver nota extensa arriba sobre
  -- por qué esta tabla es distinta a cared_persons/medications (100% de las columnas de
  -- contenido, no solo algunas). Escribir con extensions.encrypt_text(text), leer con
  -- extensions.decrypt_text(bytea) -- nunca texto plano. Sin RPC en esta issue: queda listo
  -- para que la issue de RPC/UI de F5 lo use.
  resumen bytea,
  comida bytea,
  animo bytea,
  pendientes bytea,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table shift_handovers is
  'Traspaso de turno (F5): resumen del cambio de turno, comida, ánimo y pendientes, escritos '
  'por el cuidador que cierra el turno para el que lo continúa. Relación 1:1 con shifts '
  '(shift_id UNIQUE) -- "el" traspaso de cierre de ESE turno, no un log de múltiples '
  'entradas (ver nota de diseño en esta migración). TODOS los campos de contenido van '
  'cifrados (RGPD art. 9) -- ver lista canónica de '
  'supabase/migrations/20260913210000_encryption_helpers.sql ("shift_handovers.*"). RLS '
  'aísla por family_id vía shifts (dos niveles de indirección no recursiva, mismo patrón que '
  'medical_contacts/emergency_contacts -> cared_persons en PGM-21). NO hay RPCs de lectura/ '
  'escritura en esta issue (PGM-35, solo modelo de datos) -- necesarias en una issue futura '
  'porque todos los campos de contenido son bytea cifrados.';

comment on column shift_handovers.shift_id is
  'Turno que se está cerrando. FK a shifts (PGM-25), UNIQUE -- relación 1:1, ver nota de '
  'diseño en esta migración. on delete cascade: si se borra el turno, el traspaso pierde su '
  'razón de ser.';

comment on column shift_handovers.resumen is
  'Resumen libre del cambio de turno. Dato de salud/cuidado (RGPD art. 9): SIEMPRE cifrado '
  'en reposo cuando está presente. Escribir con extensions.encrypt_text(text), leer con '
  'extensions.decrypt_text(bytea). Nullable -- criterio de producto "escritura mínima", '
  'ningún campo es obligatorio a nivel de DB en esta issue (ver nota de diseño).';

comment on column shift_handovers.comida is
  'Nota libre y corta sobre la comida durante el turno (ej. "almorzó bien, cenó poco"). Dato '
  'de salud/cuidado (RGPD art. 9): SIEMPRE cifrado en reposo cuando está presente. Mismo '
  'criterio de nullability que shift_handovers.resumen.';

comment on column shift_handovers.animo is
  'Nota libre sobre el ánimo/estado de la persona cuidada durante el turno. DECISIÓN DE '
  'DISEÑO: texto libre (no enum/escala estructurada) -- ver nota extensa en esta migración '
  'sobre por qué se eligió así y cuándo reconsiderarlo. Dato de salud/cuidado (RGPD art. 9): '
  'SIEMPRE cifrado en reposo cuando está presente. Identificador sin tilde a propósito (ver '
  'nota en esta migración) -- no tiene relación con el label mostrado en la UI.';

comment on column shift_handovers.pendientes is
  'Lista/nota libre de pendientes para el siguiente cuidador (ej. "renovar receta de '
  'ibuprofeno", "llamar al médico el lunes"). Dato de salud/cuidado (RGPD art. 9): SIEMPRE '
  'cifrado en reposo cuando está presente. Mismo criterio de nullability que '
  'shift_handovers.resumen.';

comment on column shift_handovers.created_by is
  'Usuario (miembro de la familia) que registró el traspaso -- normalmente quien cierra el '
  'turno. on delete restrict, mismo criterio que created_by en families/cared_persons/ '
  'shifts/medications. A diferencia de shifts.assigned_to o medication_logs.taken_by, NO hay '
  'necesidad de validar la membresía de OTRO usuario acá (nadie registra un traspaso "a '
  'nombre de" otro cuidador) -- por eso las policies de abajo no usan is_family_member().';

-- No se agrega un índice extra sobre shift_id: la constraint UNIQUE ya crea un índice
-- implícito, suficiente tanto para la búsqueda "traspaso de este turno" como para el join
-- de las policies de abajo.

alter table shift_handovers enable row level security;

-- shift_handovers: aísla por la family_id del shift dueño. Subquery a `shifts` (tabla
-- distinta) -- no recursiva. `shifts` a su vez ya filtra por membresía en su propia policy,
-- así que esto compone dos niveles no recursivos -- mismo patrón que medical_contacts/
-- emergency_contacts -> cared_persons (PGM-21) y medication_logs -> medications (PGM-30).
-- No hace falta is_family_member(): created_by no valida la membresía de OTRO usuario (ver
-- comment de esa columna) -- caso 3 del patrón documentado en
-- supabase/migrations/20260913250000_rls_pattern_docs.sql, no caso 2.
create policy shift_handovers_select_member
  on shift_handovers for select
  using (
    shift_id in (
      select id from shifts
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy shift_handovers_insert_member
  on shift_handovers for insert
  with check (
    shift_id in (
      select id from shifts
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

-- UPDATE: necesario porque shift_id es UNIQUE (relación 1:1) -- corregir un traspaso ya
-- creado es un UPDATE, no un INSERT nuevo (que violaría la constraint). Mismas dos
-- condiciones que INSERT, aplicadas a la fila vieja (using) y nueva (with check).
create policy shift_handovers_update_member
  on shift_handovers for update
  using (
    shift_id in (
      select id from shifts
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  )
  with check (
    shift_id in (
      select id from shifts
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );

create policy shift_handovers_delete_member
  on shift_handovers for delete
  using (
    shift_id in (
      select id from shifts
      where family_id in (select family_id from family_members where user_id = auth.uid())
    )
  );
