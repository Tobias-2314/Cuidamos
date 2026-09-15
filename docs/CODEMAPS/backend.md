<!-- Generated: 2026-09-15 | Files scanned: 14 migrations | Token estimate: ~500 -->

# Cuidamos — Backend (Supabase/Postgres)

Sin servidor propio. Todo vive en `supabase/migrations/*.sql`: schema + RLS +
funciones. Cliente: `src/lib/supabase.ts` (supabase-js, anon key).

## Regla de acceso: `.from()` vs `.rpc()`

- **`.from()` directo** funciona para tablas sin columnas cifradas y donde el
  RLS por `family_id` alcanza: `families`, `family_members`, `shifts`,
  `medications` (lectura de columnas no cifradas), `emergency_contacts`,
  `medical_contacts`.
- **`.rpc()` obligatorio** cuando hay columnas `bytea` cifradas de por medio
  (PostgREST no puede popular/leer `bytea` cifrado en un INSERT/SELECT
  directo) o la operación cruza varias tablas con lógica de negocio:

| RPC | Qué hace |
|---|---|
| `create_cared_person` | Alta de persona cuidada + `condition_notes` cifrado |
| `create_medication` / `update_medication` | Alta/edición de medicamento (name/dose/instructions cifrados) |
| `create_medication_log` | Registra toma de medicación (descifra medicamento, cifra nota) |
| `get_medications_for_family` | Lista medicamentos descifrados, visible a toda la familia |
| `get_medication_logs_for_family` | Historial de tomas descifrado, visible a toda la familia |
| `create_family_invitation` / `accept_family_invitation` | Invitar/unirse a una familia por token |
| `list_family_members` | Lista miembros de una familia (para asignar turnos) |

`shift_handovers` (PGM-35) tiene el modelo de datos + cifrado listo pero
**todavía sin RPCs de lectura/escritura** — próxima issue de Backend.

## Aislamiento entre familias (RLS)

Patrón no recursivo, replicado en toda tabla nueva: `is_family_member(family_id)`
(subquery a `family_members`, evita recursión de políticas). Ver
`supabase/migrations/20260913250000_rls_pattern_docs.sql` para el patrón de
referencia antes de crear una tabla nueva.

## Cifrado

`extensions.encrypt_text(text)` / `extensions.decrypt_text(bytea)` (pgcrypto,
AES-256). Lista canónica de qué se cifra: `data.md` (fuente real:
`supabase/migrations/20260913210000_encryption_helpers.sql`, sección "CAMPOS
DE SALUD A CIFRAR" — consultarla antes de agregar una tabla con datos de salud).

## Tests

No hay framework JS de integración — los tests de backend son SQL puro en
`supabase/tests/*.test.sql`, corridos vía `npm run test:<nombre>` →
`supabase db query --local -f supabase/tests/<archivo>`. Cubren RLS (los 4
verbos), cifrado, y unicidad. Correr todos antes de tocar una migración.
