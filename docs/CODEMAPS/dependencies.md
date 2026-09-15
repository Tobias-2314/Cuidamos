<!-- Generated: 2026-09-15 | Files scanned: package.json + config | Token estimate: ~300 -->

# Cuidamos — Dependencies & external services

## Runtime

- **Expo 51 / React Native 0.74** — app nativa Android (MVP), `expo-router` para
  navegación file-based.
- **Supabase** (`@supabase/supabase-js`) — Postgres + Auth + RLS + Storage.
  Único backend, ver `backend.md`.
- **Zod** — validación de formularios en el cliente antes de llamar a un Service.
- **expo-notifications** — recordatorios de turno/medicación (FCM por debajo,
  F6 del product-vision, no implementado todavía a fondo).

## Build y distribución

- **EAS Build** (`eas.json`, `eas-cli`) — perfiles `development`, `preview`,
  `production`. Distribución vía Play Console (track de pruebas cerradas).
- **Supabase CLI** — migraciones, tipos TS (`db:types` → `src/lib/database.types.ts`),
  entorno local (`db:start`/`db:reset`).

## Testing

- **Jest** — unit tests JS/TS (`npm test`).
- **Sin framework E2E todavía** (Detox/Maestro no configurado — pendiente si se
  prioriza, ver `testing.md` de las reglas del proyecto).
- Tests de backend: SQL puro en `supabase/tests/`, no una librería npm.

## Gestión de trabajo

- **YouTrack** (proyecto `PGM`) — tracking de issues, vía MCP + skill `dev-loop`.
- **`/team`** (skill propio) — pipeline de 7 agentes (PM/UX/Database/Backend/
  Frontend/DevOps/QA) para features completas, ver `~/.claude/skills/team/SKILL.md`.

## No usado (para no asumir de más)

Sin Next.js, sin Express/NestJS, sin Prisma/Drizzle (el ORM es supabase-js +
SQL directo en migraciones), sin Redis, sin Docker propio más allá del stack
local de Supabase.
