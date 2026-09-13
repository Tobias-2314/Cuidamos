-- Datos de desarrollo local (`supabase db reset`).
--
-- Reglas:
--   * Nunca datos reales de familias, personas cuidadas o salud.
--   * Solo lo mínimo para poder desarrollar/probar contra un estado no vacío.
--
-- Vacío por ahora: T1 solo deja la infraestructura lista. Los seeds de F1 (familias/usuarios)
-- se agregan junto con las migraciones de esas features.

-- PGM-3: setea automáticamente la clave de cifrado de DESARROLLO en cada `db:reset`.
--
-- IMPORTANTE -- verificado empíricamente: `supabase db reset` recrea los roles del clúster
-- de Postgres, así que el `grant set on parameter` que habilita a `postgres` para poder
-- correr el `alter database ... set` de abajo NO sobrevive a un reset. Ese grant hay que
-- rehacerlo a mano DESPUÉS DE CADA reset (ver README > Migraciones, y la sección 2 de
-- supabase/migrations/20260913210000_encryption_helpers.sql):
--
--   docker exec -i supabase_db_cuidamos psql -U supabase_admin -d postgres -c \
--     'grant set on parameter "app.settings.encryption_key" to postgres;'
--
-- Si todavía no corriste ese grant en este stack de Docker, el `alter database` de abajo
-- va a fallar con "insufficient_privilege". Este bloque lo atrapa y solo avisa con un
-- warning (no rompe el resto del seed) -- pero hasta que corras el grant a mano y repitas
-- `npm run db:reset`, `npm run test:encryption` va a fallar porque la GUC no va a estar
-- seteada.
do $$
begin
  execute $sql$
    alter database postgres set app.settings.encryption_key =
      'local-dev-only-insecure-key-do-not-use-in-staging-or-prod'
  $sql$;
exception
  when insufficient_privilege then
    raise warning
      'PGM-3: no se pudo setear app.settings.encryption_key (falta el grant manual). '
      'Corré el comando "grant set on parameter" documentado en supabase/seed.sql / '
      'README, y volvé a correr npm run db:reset. Hasta entonces, npm run '
      'test:encryption va a fallar.';
end $$;
