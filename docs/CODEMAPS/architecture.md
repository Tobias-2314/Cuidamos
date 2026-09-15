<!-- Generated: 2026-09-15 | Files scanned: 93 | Token estimate: ~450 -->

# Cuidamos — Architecture

App móvil (coordinación de cuidado familiar) sobre Expo/React Native + Supabase.
Sin backend propio: toda la lógica server-side vive en Postgres (RLS + funciones
`security definer`), no hay servidor Node intermedio.

```
Expo Router page (app/**)
        │  importa y renderiza
        ▼
Screen component (src/features/<feature>/*Screen.tsx)
        │  usa
        ▼
*Service.ts (src/features/<feature>/*Service.ts)
        │  supabase-js: .from() (tablas planas) / .rpc() (cifrado o lógica multi-tabla)
        ▼
Supabase Postgres (RLS por family_id + RPCs security definer)
```

## Features (carpetas en `src/features/`)

| Feature | Screens | Service |
|---|---|---|
| auth | LoginScreen | authService |
| cared-persons | CaredPersonFormScreen, CaredPersonProfileScreen, EmergencyContactFormScreen, MedicalContactFormScreen | caredPersonsService, contactsService |
| family | CreateFamilyScreen, InviteFamilyScreen, AcceptInvitationScreen | familyService |
| medications | MedicationsScreen, MedicationFormScreen, MedicationHistoryScreen | medicationsService |
| shifts | CalendarScreen, CoverageScreen, ShiftFormScreen, ShiftReassignScreen, AssigneePicker | shiftsService |

## Principio de seguridad transversal

Todo dato de salud (RGPD art. 9) se cifra en Postgres con pgcrypto y solo se
lee/escribe vía RPC `security definer` — nunca `.from()` directo sobre columnas
`bytea`. Ver `data.md` para la lista canónica de campos cifrados y `backend.md`
para las RPCs. Todo aislamiento entre familias es RLS por `family_id`, patrón
no recursivo (subquery a `family_members`, ver `is_family_member()`).

## Fuente de verdad de producto

`docs/product-vision.md` — MVP, alcance, no-negociables (RGPD, Google Play).
Cualquier feature nueva debe poder justificarse contra ese documento.
