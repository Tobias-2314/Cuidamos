# Cuidamos

App móvil para coordinar el cuidado de un familiar mayor dependiente entre varios cuidadores.

Ver la visión completa en [`docs/product-vision.md`](./docs/product-vision.md).

## Stack

- **App**: React Native + Expo (TypeScript, expo-router)
- **Backend**: Supabase (Postgres + Auth + RLS + Storage)
- **Notificaciones**: expo-notifications

## Setup

```bash
# 1) Dependencias
npm install

# 2) Supabase local (requiere Docker corriendo)
npx supabase start

# 3) Variables de entorno
cp .env.example .env
# Editar .env con los valores que devuelve `supabase start` (URL + anon key)

# 4) Arrancar Expo
npm start
```

## Estructura

```
app/                 # rutas expo-router
src/
  lib/               # clientes (supabase, notifs)
  components/        # componentes UI
  features/          # lógica por feature (auth, shifts, medications, ...)
supabase/
  config.toml        # config local
  migrations/        # migraciones SQL versionadas
docs/
  product-vision.md  # fuente de verdad del producto
```

## Cómo se construye

Este repo es desarrollado por el bucle `/dev-loop` orquestado desde Claude Code, que consume el backlog del proyecto **PGM** en YouTrack. Cada issue en `To do` con `Equipo` ∈ {Backend, Frontend, DevOps} se procesa, se implementa, se revisa por un Tech Lead y se commitea localmente (sin push automático).
