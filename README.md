# Cuidamos

App móvil para coordinar el cuidado de un familiar mayor dependiente entre varios cuidadores.

Ver la visión completa en [`docs/product-vision.md`](./docs/product-vision.md).

## Stack

- **App**: React Native + Expo (TypeScript, expo-router)
- **Backend**: Supabase (Postgres + Auth + RLS + Storage)
- **Notificaciones**: expo-notifications

## Setup

Requisitos: Node.js, npm, y **Docker** corriendo (Supabase local levanta Postgres, Auth, Storage, etc. como contenedores).

```bash
# 1) Dependencias (incluye el CLI de Supabase, pineado como devDependency)
npm install

# 2) Supabase local
npm run db:start
# La primera vez descarga las imágenes de Docker (puede tardar varios minutos).
# Al terminar imprime API URL, anon key, service_role key, Studio URL, etc.
# Podés volver a verlas en cualquier momento con: npm run db:status

# 3) Variables de entorno
cp .env.example .env
# Completar .env con la "API URL" y el "anon key" que devolvió el paso anterior.
# NUNCA pegar la service_role key acá — ver "Variables de entorno y secretos" más abajo.

# 4) Arrancar Expo
npm start
```

Para parar los contenedores: `npm run db:stop`.

## Migraciones

El esquema de la base vive **solo** como SQL versionado en `supabase/migrations/`. Nadie edita tablas a mano en Studio y las deja así — todo cambio de esquema es una migración commiteada.

```bash
# Crear una migración nueva (abre supabase/migrations/<timestamp>_<nombre>.sql)
npm run db:migration:new -- nombre_de_la_migracion

# Aplicar migraciones + seed contra la base LOCAL desde cero
npm run db:reset

# Aplicar las migraciones pendientes contra un proyecto remoto (staging o prod-cerrado)
# Requiere estar logueado (`npx supabase login`) y linkeado al proyecto:
npx supabase link --project-ref <project-ref-de-staging-o-prod>
npm run db:push

# Ver si el esquema local difiere del remoto antes de pushear
npm run db:diff
```

Reglas:

- Una migración por cambio lógico de esquema; nunca editar una migración ya commiteada y pusheada — crear una nueva.
- Los campos de salud (condición médica, notas de medicación, etc.) se cifran en reposo con `pgcrypto` (ver `supabase/migrations/20260913171432_enable_extensions.sql`) y llevan RLS estricto — esto es no negociable por RGPD art. 9 (ver `docs/product-vision.md`).
- `supabase/seed.sql` es solo para datos de desarrollo local, nunca datos reales de familias.

## Cifrado en reposo (pgcrypto)

Los campos de salud (condición médica, medicación, notas de cambio de turno, etc. — ver la
lista canónica en `supabase/migrations/20260913210000_encryption_helpers.sql`) se cifran en
reposo con `pgcrypto` (AES-256) a través de las funciones `extensions.encrypt_text(text)` /
`extensions.decrypt_text(bytea)`. No negociable por RGPD art. 9.

La clave vive en la GUC de Postgres `app.settings.encryption_key`, nunca hardcodeada.

**Paso manual en LOCAL, después de CADA `npm run db:start` / `npm run db:reset`:**

`supabase db reset` recrea los roles del clúster de Postgres, así que el permiso para
setear esta GUC custom NO sobrevive a un reset — hay que rehacer este `grant` cada vez
(no una sola vez por stack de Docker):

```bash
docker exec -i supabase_db_cuidamos psql -U supabase_admin -d postgres -c \
  'grant set on parameter "app.settings.encryption_key" to postgres;'
docker exec -i supabase_db_cuidamos psql -U postgres -d postgres -c \
  "alter database postgres set app.settings.encryption_key = 'local-dev-only-insecure-key-do-not-use-in-staging-or-prod';"
```

`supabase/seed.sql` repite automáticamente el segundo comando en cada `db:reset` (con un
warning si el grant todavía no se hizo), pero el `grant` en sí requiere el rol
`supabase_admin` y hay que correrlo a mano.

Verificar con: `npm run test:encryption` (smoke test versionado en
`supabase/tests/encryption.test.sql`).

En staging/prod-cerrado la clave se configura vía Supabase Cloud (ver "Entornos" abajo,
punto pendiente) con un valor generado criptográficamente, guardado solo en el gestor de
secretos de CI/CD — nunca en un archivo del repo.

## Entornos

Tres entornos, todos proyectos Supabase separados (no hay un solo proyecto con "modo staging"):

| Entorno | Dónde corre | Uso |
|---|---|---|
| **dev** | Local, vía Docker (`npm run db:start`) | Desarrollo día a día, cada dev en su máquina |
| **staging** | Supabase Cloud (proyecto `cuidamos-staging`) | Validar releases antes de la beta, QA |
| **prod-cerrado** | Supabase Cloud (proyecto `cuidamos-prod`) | Beta cerrada con familias reales (datos de salud reales) |

Cada entorno tiene su propio `.env.<entorno>` (nunca commiteado) basado en la plantilla correspondiente:

- `.env.example` → dev/local
- `.env.staging.example` → staging
- `.env.production.example` → prod-cerrado

**Pendiente manual (requiere consola de Supabase Cloud, no se puede scriptear desde acá):**

1. Crear los proyectos `cuidamos-staging` y `cuidamos-prod` en https://supabase.com/dashboard.
2. En cada uno: Project Settings → API → copiar `URL` y `anon key` → completar el `.env.<entorno>` correspondiente (no commitear).
3. Copiar la `service_role key` de cada proyecto como secreto en el sistema de CI/CD (EAS Secrets / GitHub Actions), nunca en un archivo del repo.
4. `npx supabase link --project-ref <ref>` desde cada máquina/pipeline que necesite pushear migraciones a ese entorno.
5. En prod-cerrado, revisar que `auth.email.enable_confirmations` esté en `true` (a diferencia de dev) antes de invitar familias reales.
6. Setear `app.settings.encryption_key` (clave de cifrado en reposo, PGM-3) en cada proyecto Cloud con un valor generado criptográficamente (ej. `openssl rand -base64 32`), guardado solo en el gestor de secretos de CI/CD — ver "Cifrado en reposo" arriba. Verificar ANTES de invitar familias reales a prod-cerrado.

## Builds (EAS Build)

Los builds de Android (APK de pruebas y AAB para Play Store) se generan con **EAS Build**,
el servicio de build gestionado de Expo — no hay Docker/CI propio para esto. La config vive
en `eas.json` (raíz del repo), con tres perfiles:

| Perfil | Salida | Distribución | Entorno de datos | Uso |
|---|---|---|---|---|
| `development` | APK con Expo Dev Client | `internal` | local (Docker, vía Metro) | Iterar rápido con dev client en un dispositivo/emulador real |
| `preview` | APK | `internal` | staging (`cuidamos-staging`) | Pruebas internas/cerradas antes de la beta |
| `production` | AAB firmado | store | prod-cerrado (`cuidamos-prod`) | Publicación en Play Console (track de pruebas cerradas) |

El CLI de EAS (`eas-cli`) está pineado como **devDependency** del repo (no instalado global)
para que todos —y el futuro CI— usen exactamente la misma versión; se invoca con `npx eas-cli`
o vía los scripts de npm de abajo. `eas.json` además fija `cli.version` (`>= 24.3.0`) para que
el comando falle rápido si alguien corre una versión de EAS CLI más vieja e incompatible.

**Variables de entorno por perfil:** cada perfil declara `"environment": "development" | "preview" | "production"`
en vez de valores literales en `eas.json` — apunta a las variables gestionadas en el dashboard
de EAS (`eas env:create` / EAS Secrets), nunca a un valor hardcodeado en el repo. Esto es
consistente con el resto del proyecto: `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`
de staging/prod-cerrado solo existen como secreto en EAS, nunca en un archivo versionado.
El perfil `development` casi no depende de esto en la práctica: con `developmentClient: true`
el JS lo sigue sirviendo Metro local (lee tu `.env` de siempre), el build de EAS solo genera
el binario nativo del dev client.

**Pendiente manual (requiere cuenta real de Expo/EAS y no se puede scriptear desde acá):**

1. Crear una cuenta/organización en https://expo.dev y correr `npx eas login`.
2. Vincular el proyecto: `npx eas init` (o `npx eas build:configure --platform android`) — esto
   agrega `extra.eas.projectId` a `app.json`. No se hizo acá a propósito: un `projectId` puesto
   a mano sin cuenta real quedaría inválido y rompería el link real más adelante.
3. Cargar los EAS Secrets/env vars por entorno (`eas env:create --environment preview ...` y
   `--environment production ...`) con los valores reales de `cuidamos-staging` / `cuidamos-prod`
   (ver "Entornos" arriba) — nunca commitear esos valores.
4. Para `production`: configurar credenciales de firma Android (`eas credentials`) y, más
   adelante (fuera del alcance de esta issue), el submit automático a Play Console necesita
   un service account JSON de Google Play, cargado también como secreto de EAS, nunca en el repo.

**Comandos** (una vez resuelto lo anterior):

```bash
# development: APK con Dev Client, para iterar contra Metro local
npm run build:dev      # == eas build --profile development --platform android

# preview: APK para pruebas internas/cerradas, apunta a staging
npm run build:preview  # == eas build --profile preview --platform android

# production: AAB firmado para Play Store, apunta a prod-cerrado
npm run build:prod     # == eas build --profile production --platform android
```

## Variables de entorno y secretos

- `EXPO_PUBLIC_*` son las únicas variables que puede leer la app — terminan empaquetadas en el bundle, así que son públicas por definición. Solo van acá `SUPABASE_URL` y el `anon key` (protegido por RLS del lado del servidor).
- La **service_role key** salta todo RLS: nunca va en un `.env` que lea la app, nunca en `EXPO_PUBLIC_*`, nunca en un commit. Vive únicamente como secreto en scripts de backend/CI que corren fuera del bundle de la app.
- Ningún `.env*` real se commitea (ver `.gitignore`); solo los `*.example` sirven de plantilla.

## Estructura

```
app/                 # rutas expo-router
src/
  lib/               # clientes (supabase, notifs)
  components/        # componentes UI
  features/          # lógica por feature (auth, shifts, medications, ...)
supabase/
  config.toml        # config local
  migrations/        # migraciones SQL versionadas (única fuente de verdad del esquema)
  seed.sql           # datos de desarrollo local (no sensibles)
docs/
  product-vision.md  # fuente de verdad del producto
```

## Cómo se construye

Este repo es desarrollado por el bucle `/dev-loop` orquestado desde Claude Code, que consume el backlog del proyecto **PGM** en YouTrack. Cada issue en `To do` con `Equipo` ∈ {Backend, Frontend, DevOps} se procesa, se implementa, se revisa por un Tech Lead y se commitea localmente (sin push automático).
