<!-- Generated: 2026-09-15 | Files scanned: 14 migrations | Token estimate: ~500 -->

# Cuidamos — Data model (Postgres/Supabase)

## Tablas y relaciones

```
families (dueño: created_by → auth.users)
  └─ family_members (family_id, user_id, role: admin|cuidador) — unique(family_id,user_id)
  └─ family_invitations (family_id, token uuid único, expires_at, used_at/used_by)
  └─ cared_persons (family_id) — 1 sola por familia en el MVP
       └─ emergency_contacts (cared_person_id)
       └─ medical_contacts (cared_person_id)
       └─ medications (cared_person_id)
            └─ medication_logs (medication_id, quién marcó la toma)
  └─ shifts (family_id, cared_person_id nullable, assigned_to → auth.users)
       └─ shift_handovers (shift_id) — modelo listo, sin RPC todavía (PGM-35)
```

Todo `family_id` (directo o indirecto vía FK) es la unidad de aislamiento RLS.
Ninguna tabla duplica `family_id` si puede resolverse vía join (2 niveles máx.,
no recursivo) — ver `backend.md`.

## Campos cifrados (lista canónica — RGPD art. 9)

Fuente real: `supabase/migrations/20260913210000_encryption_helpers.sql`,
sección "CAMPOS DE SALUD A CIFRAR". **Consultar ese archivo antes de agregar
una columna de salud nueva** — esta tabla es un resumen, no la fuente.

| Tabla | Columnas cifradas (`bytea`) | No cifradas |
|---|---|---|
| `cared_persons` | `condition_notes` | full_name, birth_date, consent_given_at |
| `medications` | `name`, `dose`, `instructions` | `schedule` (texto libre, no es dato médico) |
| `medication_logs` | nota de la toma | taken_at, quién la marcó |
| `shift_handovers` | **las 4** (resumen, comida, ánimo, pendientes) — único caso de cifrado 100% | — |

Cifrado/descifrado: `extensions.encrypt_text(text)` / `extensions.decrypt_text(bytea)`
(pgcrypto AES-256, clave única vía GUC). Nunca texto plano en columnas de salud.

## Notas de diseño no obvias

- `families.created_by` → `on delete restrict` (bloquea borrar el usuario dueño
  hasta que exista feature de "baja de cuenta" — decisión explícita, no bug).
- `shifts.cared_person_id` nullable + `on delete set null` (un turno no
  desaparece si se borra la persona cuidada).
- `family_invitations`: el control de acceso real es el `token` random, NO el
  `invited_email` (ese campo es solo informativo para la UI).
