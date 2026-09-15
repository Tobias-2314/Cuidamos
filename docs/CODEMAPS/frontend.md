<!-- Generated: 2026-09-15 | Files scanned: 33 tsx + app/ | Token estimate: ~350 -->

# Cuidamos — Frontend (Expo Router)

Expo Router (file-based). Las páginas en `app/` son wrappers finos que
importan y renderizan un Screen de `src/features/<feature>/`.

## Árbol de páginas

```
app/
  _layout.tsx              layout raíz (navegación)
  index.tsx                login / entrada
  calendar.tsx              → CalendarScreen (shifts)
  medications.tsx           → MedicationsScreen
  medications/
    new.tsx                 → MedicationFormScreen (alta)
    [id]/edit.tsx            → MedicationFormScreen (edición)
    history.tsx              → MedicationHistoryScreen
  cared-person/
    index.tsx                → CaredPersonProfileScreen
    new.tsx                   → CaredPersonFormScreen
    emergency-contacts/new.tsx → EmergencyContactFormScreen
    medical-contacts/new.tsx   → MedicalContactFormScreen
  family/
    create.tsx                → CreateFamilyScreen
    invite.tsx                 → InviteFamilyScreen
  join/[token].tsx            → AcceptInvitationScreen (deep link de invitación)
  shifts/
    new.tsx                    → ShiftFormScreen
    coverage.tsx                → CoverageScreen (reparto de horas por cuidador)
    [id]/reassign.tsx           → ShiftReassignScreen
```

## Convención por feature

Cada `src/features/<feature>/` trae: Screen(s) (UI + estado), `*Service.ts`
(único punto de contacto con Supabase para esa feature) y helpers de
formato/validación puros (ej. `medicationFormatting.ts`, `calendarSections.ts`,
`coverageStats.ts`, `assignedToLabel.ts`) — sin llamadas a red, testeables
sin mocks pesados.

## Validación

Zod (`zod` en dependencies) para inputs de formularios antes de llamar al
Service correspondiente.
