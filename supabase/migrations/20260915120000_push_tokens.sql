-- PGM-10: [F6] Notificaciones push -- base de datos: tabla push_tokens + RLS + RPC de
-- registro (`register_push_token`).
--
-- ----------------------------------------------------------------------------------------
-- ALCANCE DE ESTA MIGRACIÓN vs. alcance completo de la issue original (PGM-10)
-- ----------------------------------------------------------------------------------------
-- La issue original pide 4 cosas: (1) schema push_tokens, (2) Edge Function `send_push` que
-- llama a la API de Expo, (3) trigger/cron que detecte turnos próximos y medicación
-- pendiente y dispare el envío, (4) RLS sobre push_tokens. Mismo criterio ya usado en este
-- repo para issues grandes (PGM-35 `shift_handovers`: modelo de datos primero, RPC/UI
-- después en issues futuras -- ver ese archivo): esta migración entrega (1) y (4) -- la base
-- de datos innegociable -- MÁS una RPC de registro razonable (`register_push_token`), que no
-- estaba explícitamente pedida como "issue futura" pero es una extensión mínima y seguidura
-- de (1)/(4) (sin ella, ningún cliente podría poblar la tabla vía PostgREST sin exponer
-- `user_id` como columna editable por el cliente -- ver policy de INSERT más abajo).
--
-- NO se implementa en esta migración -- y no se debe simular una versión a medias insegura
-- de esto -- la Edge Function `send_push` ni el trigger/cron (pg_cron / Supabase scheduled
-- function) que detecta turnos próximos/medicación pendiente y dispara el envío real:
--   * Es código fuera de SQL (una Edge Function en Deno/TypeScript bajo supabase/functions/,
--     que no existe todavía en este repo -- confirmado con `ls supabase/` antes de escribir
--     esta migración) que requiere secrets propios (credenciales de la API de Expo push,
--     `EXPO_ACCESS_TOKEN` si se usa autenticación, URL del endpoint
--     https://exp.host/--/api/v2/push/send) y un paso de DESPLIEGUE (`supabase functions
--     deploy send_push` + `supabase secrets set`) que no se puede completar ni verificar
--     dentro de una migración SQL ejecutada contra el stack local.
--   * El disparo periódico (pg_cron corriendo cada N minutos, o una scheduled function) que
--     "detecta turnos que empiezan en X min y medicaciones sin marcar tras Y min" depende de
--     DECISIONES DE PRODUCTO que no están definidas en ningún documento (docs/product-vision.md
--     no fija X ni Y minutos, ni el mensaje exacto de la notificación) -- inventar esos
--     valores sin confirmación de producto sería adivinar. Además, para que el cron llame
--     server-side a `send_push()` con contenido de notificación necesita leer
--     `medications.name` (cifrado, ver PGM-3) -- eso significa que la función de cron
--     necesita `extensions.decrypt_text()` para poder mostrar el nombre de la medicación en
--     el texto de la notificación (dato de salud, RGPD art. 9 -- ver nota de PGM-3 en la
--     sección "CAMPOS DE SALUD A CIFRAR"). Diseñar ese flujo completo (qué texto exacto va
--     en el push, si se trunca/omite el nombre de la medicación por privacidad ya que
--     push notifications pueden mostrarse en la lock screen del teléfono, etc.) es trabajo
--     de producto + backend sustancialmente distinto al de esta migración -- documentado
--     como ISSUE FUTURA sugerida en NOTES del agente, no inventado acá.
--
-- Dependencias declaradas por la issue (T1, T3, F1, F3, F4) ya están implementadas en el
-- repo (T1 = extensiones/gen_random_uuid, T3 = is_family_member()/RLS pattern, F1 =
-- families/family_members, F3 = shifts, F4 = medications) -- confirmado repasando
-- supabase/migrations/ completo antes de escribir esta migración.
--
-- ----------------------------------------------------------------------------------------
-- DISEÑO: `push_tokens`
-- ----------------------------------------------------------------------------------------
--   - Tabla dueña por USUARIO, no por familia: a diferencia del resto del dominio
--     (cared_persons/shifts/medications/shift_handovers, todas aisladas por family_id vía el
--     patrón de supabase/migrations/20260913250000_rls_pattern_docs.sql), un push token es
--     una credencial de ENTREGA (a qué instalación de la app en qué dispositivo se le puede
--     mandar una notificación) ligada al usuario logueado en ese dispositivo, no a una
--     familia. Ningún otro miembro de la familia debe poder leer ni modificar el token de
--     push de otro usuario -- ver policies "dueño-only" más abajo (mismo patrón ya usado por
--     `_encryption_poc` en PGM-3 para RLS dueño-only simple, `owner_id = auth.uid()`, solo
--     que acá la columna se llama `user_id` para que el nombre sea autoexplicativo en esta
--     tabla de dominio real).
--   - `device`: identificador ESTABLE de la instalación de la app en un dispositivo
--     concreto, generado y persistido por el cliente (ej. un uuid guardado en
--     `expo-secure-store` o `AsyncStorage` la primera vez que la app corre en ese
--     dispositivo -- decisión de implementación del Frontend, fuera del alcance de esta
--     migración). NO es el nombre comercial del dispositivo ("Pixel 8") ni un dato de salud
--     -- es un identificador técnico. Existe para que `register_push_token()` pueda hacer
--     upsert por (user_id, device): si el mismo dispositivo pide un token nuevo (Expo puede
--     rotar el token en el tiempo), se ACTUALIZA la fila existente en vez de acumular filas
--     viejas con tokens vencidos -- ver UNIQUE más abajo.
--   - `expo_token`: el token real de Expo Push (`ExponentPushToken[...]`), la credencial que
--     usará la futura Edge Function `send_push` para llamar a
--     https://exp.host/--/api/v2/push/send. No es un dato de salud (PGM-3 no lo incluye en
--     la lista canónica de campos a cifrar) -- es un identificador de entrega de
--     notificaciones push, equivalente en sensibilidad a un token de dispositivo de FCM/APNs
--     (se filtra igual que cualquier otro identificador técnico si se expone, pero no revela
--     nada sobre la salud/cuidado de la persona cuidada) -- se guarda en texto plano, sin
--     cifrar, consistente con esa lista canónica.
--   - `platform`: 'android' | 'ios'. Se incluyen ambos valores aunque el criterio de
--     producto es "Android-first" (docs/product-vision.md) -- Expo Notifications/FCM
--     funciona en ambas plataformas sin costo adicional de modelado (un CHECK con dos
--     valores en vez de uno), y no hay ningún requisito de producto que diga "prohibir iOS a
--     nivel de datos" -- Android-first es una prioridad de EJECUCIÓN/QA, no una restricción
--     de schema. No se incluye 'web': el criterio "permisos mínimos, solo notificaciones" y
--     "Android-first (Expo + FCM)" de docs/product-vision.md no menciona web push, y Expo
--     Notifications para web tiene un flujo bastante distinto (Service Worker, VAPID) que no
--     está en el alcance actual -- YAGNI, se agrega si aparece un caso de uso confirmado.
--   - UNIQUE (user_id, device): un usuario tiene A LO SUMO un push token registrado por
--     dispositivo -- reflejado en `register_push_token()` como upsert (`on conflict ...
--     do update`). Se elige esta clave en vez de UNIQUE global sobre `expo_token` a
--     propósito: varios usuarios de una misma familia pueden compartir un dispositivo físico
--     (ej. una tablet familiar) sin logout entre sesiones en escenarios que no controla esta
--     migración -- Expo podría (en teoría) devolver temporalmente el mismo token a dos
--     "usuarios lógicos" de la app en el mismo dispositivo antes de que el primero lo
--     invalide. Forzar UNIQUE global sobre expo_token rompería ese caso con un error de
--     constraint en vez de simplemente re-registrar; UNIQUE(user_id, device) alcanza para el
--     caso de uso real (evitar filas duplicadas para EL MISMO usuario en EL MISMO
--     dispositivo) sin ese riesgo. Si en el futuro aparece evidencia de tokens duplicados
--     entre usuarios causando envíos erróneos, es un ALTER TABLE acotado, no un problema de
--     diseño de esta migración (YAGNI).
--   - No hay `family_id` en esta tabla (a propósito): un push token no pertenece a una
--     familia, pertenece a un usuario. Si una issue futura necesita "mandar push a todos los
--     miembros de la familia X", esa lógica se resuelve en la Edge Function/cron futura
--     haciendo join con `family_members` (que sí tiene family_id) -- no duplicando family_id
--     acá sin necesidad confirmada.

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device text not null check (char_length(trim(device)) > 0),
  expo_token text not null check (char_length(trim(expo_token)) > 0),
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device)
);

comment on table push_tokens is
  'PGM-10 (F6): token de Expo Push por (usuario, dispositivo), usado por la futura Edge '
  'Function send_push para notificar turno próximo / medicación pendiente. Dueña por '
  'usuario (no por familia) -- RLS dueño-only, ver policies de esta migración. UNIQUE '
  '(user_id, device): register_push_token() hace upsert, no acumula tokens vencidos del '
  'mismo dispositivo. NO incluye la Edge Function send_push ni el cron/scheduled function '
  'que dispara los envíos reales -- ver nota extensa de alcance al inicio de esta migración '
  '(20260915120000_push_tokens.sql) y NOTES del agente que la implementó (PGM-10) para el '
  'detalle de qué queda pendiente como issue futura.';

comment on column push_tokens.user_id is
  'Dueño del token -- SIEMPRE auth.uid() de quien lo registra, nunca un parámetro libre del '
  'cliente (ver register_push_token(), que lo fija internamente). on delete cascade: si se '
  'borra el usuario, sus tokens de push dejan de tener sentido.';

comment on column push_tokens.device is
  'Identificador técnico ESTABLE de la instalación de la app en un dispositivo concreto '
  '(generado y persistido por el cliente, ej. un uuid en secure storage) -- no es el nombre '
  'comercial del dispositivo ni un dato de salud. Clave de upsert junto con user_id.';

comment on column push_tokens.expo_token is
  'Token de Expo Push (formato ExponentPushToken[...]) que usará la futura Edge Function '
  'send_push para llamar a la API de Expo. No es un dato de salud (no está en la lista '
  'canónica de PGM-3) -- se guarda en texto plano, sin cifrar, igual que cualquier otro '
  'identificador técnico de entrega (equivalente a un token FCM/APNs crudo).';

comment on column push_tokens.platform is
  '''android'' o ''ios''. Ver nota de diseño en esta migración sobre por qué no se incluye '
  '''web'' (YAGNI, sin caso de uso confirmado) a pesar del criterio Android-first de '
  'docs/product-vision.md (esa prioridad es de ejecución/QA, no una restricción de schema).';

comment on constraint push_tokens_user_id_device_key on push_tokens is
  'Un usuario tiene a lo sumo un token registrado por dispositivo -- register_push_token() '
  'usa esta constraint como clave de upsert (on conflict (user_id, device) do update), para '
  'no acumular filas con tokens vencidos del mismo dispositivo tras una rotación de Expo.';

-- Índice adicional para "¿qué usuarios tienen push token?" (lookup de la futura Edge
-- Function/cron, ej. "traer los tokens de todos los miembros de una familia" vía join con
-- family_members por user_id) -- el UNIQUE (user_id, device) ya cubre las búsquedas por
-- user_id como primer componente, pero se documenta explícitamente por qué no hace falta un
-- índice separado: btree sobre (user_id, device) ya sirve para "where user_id = X".
comment on index push_tokens_user_id_device_key is
  'El índice único sobre (user_id, device) ya sirve como índice de lookup por user_id solo '
  '(user_id es el primer componente) -- no se crea un índice separado a propósito, sería '
  'redundante. Uso esperado: la futura Edge Function/cron de send_push buscando los tokens '
  'de un conjunto de usuarios (ej. miembros de una familia).';

alter table push_tokens enable row level security;

-- push_tokens: dueño-only, sin indirección de familia (ver nota de diseño arriba). Mismo
-- patrón que _encryption_poc (PGM-3) pero con la columna llamada user_id en vez de
-- owner_id, más autoexplicativa en una tabla de dominio real.
create policy push_tokens_select_own
  on push_tokens for select
  using (user_id = auth.uid());

create policy push_tokens_insert_own
  on push_tokens for insert
  with check (user_id = auth.uid());

create policy push_tokens_update_own
  on push_tokens for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_tokens_delete_own
  on push_tokens for delete
  using (user_id = auth.uid());

-- Sin `revoke`/`grant` explícitos a nivel de tabla acá -- mismo criterio que el resto del
-- dominio (families/shifts/medications/family_invitations): se apoya en los grants por
-- default de Supabase para `authenticated` sobre el schema `public` más las policies de RLS
-- de arriba, que son las que hacen el control de acceso real.

-- ============================================================================
-- register_push_token(): upsert seguro del propio token, para uso desde el cliente JS
-- ============================================================================
-- Aunque las 4 policies de arriba ya alcanzan para que el cliente use `.upsert()` directo de
-- supabase-js sobre push_tokens (a diferencia de cared_persons/medications/shift_handovers,
-- ninguna columna de esta tabla es bytea cifrada -- no hay bloqueo técnico de PostgREST
-- acá), se expone igual esta RPC de conveniencia por dos razones:
--   1. Evita que el cliente tenga que mandar `user_id` explícitamente en el payload del
--      upsert (aunque la policy lo rechazaría si no coincide con auth.uid(), es más simple y
--      a prueba de errores que el cliente ni siquiera tenga la opción de mandar un
--      `user_id` equivocado -- esta función lo fija siempre a auth.uid() internamente).
--   2. Centraliza la clave de upsert (`on conflict (user_id, device)`) en un solo lugar en
--      vez de esperar que cada call site del cliente arme el `.upsert()` de supabase-js con
--      el `onConflict` correcto -- mismo criterio de "un solo lugar para la lógica de
--      escritura" que create_medication/create_cared_person.
-- `security invoker` (NO `security definer`): esta función no amplía ni evita ningún
-- permiso, sigue sujeta a push_tokens_insert_own/push_tokens_update_own -- si por algún
-- bug futuro se le pasara un user_id distinto de auth.uid() (no es posible hoy, esta función
-- ni siquiera acepta ese parámetro), la policy lo bloquearía igual.
create or replace function public.register_push_token(
  p_device text,
  p_expo_token text,
  p_platform text
)
returns table (
  id uuid,
  user_id uuid,
  device text,
  expo_token text,
  platform text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
-- Los nombres de las columnas de salida (RETURNS TABLE) coinciden a propósito con los de
-- push_tokens (id, user_id, device, expo_token, platform, created_at, updated_at) -- sin
-- este pragma, Postgres rechaza la función entera con "column reference ... is ambiguous"
-- apenas se referencia `user_id`/`device` en el `on conflict (user_id, device)` de más
-- abajo (el identificador podría resolver tanto a la columna real de la tabla como al
-- parámetro OUT del mismo nombre) -- verificado empíricamente al ejecutar esta migración
-- contra el stack local. `use_column` le dice a PL/pgSQL que, ante esa ambigüedad, gane
-- SIEMPRE la columna de la tabla (nunca la variable/parámetro OUT) -- el comportamiento
-- correcto acá, porque esta función nunca lee esas variables OUT antes de que el `insert
-- ... returning` las puebla (se declaran solo para tipar el resultado).
begin
  if p_device is null or char_length(trim(p_device)) = 0 then
    raise exception 'device no puede estar vacío' using errcode = '22023'; -- invalid_parameter_value
  end if;

  if p_expo_token is null or char_length(trim(p_expo_token)) = 0 then
    raise exception 'expo_token no puede estar vacío' using errcode = '22023'; -- invalid_parameter_value
  end if;

  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'platform debe ser ''android'' o ''ios'' (recibido: %)', p_platform
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  return query
  insert into push_tokens (user_id, device, expo_token, platform)
  values (auth.uid(), p_device, p_expo_token, p_platform)
  on conflict (user_id, device)
  do update set
    expo_token = excluded.expo_token,
    platform = excluded.platform,
    updated_at = now()
  returning
    push_tokens.id,
    push_tokens.user_id,
    push_tokens.device,
    push_tokens.expo_token,
    push_tokens.platform,
    push_tokens.created_at,
    push_tokens.updated_at;
end;
$$;

comment on function public.register_push_token(text, text, text) is
  'PGM-10: registra/actualiza (upsert por (user_id, device)) el token de Expo Push del '
  'usuario autenticado. `user_id` SIEMPRE auth.uid() -- no es un parámetro, el cliente no '
  'puede registrar un token a nombre de otro usuario. `security invoker`: sigue sujeta a '
  'push_tokens_insert_own/push_tokens_update_own, esta función no amplía permisos, solo '
  'evita que el cliente arme el upsert/onConflict a mano. Valida device/expo_token no '
  'vacíos y platform in (''android'',''ios'') server-side (falla rápido con '
  'invalid_parameter_value), mismo criterio que create_medication/create_cared_person.';

revoke all on function public.register_push_token(text, text, text) from public;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- ============================================================================
-- unregister_push_token(): borra el propio token de un dispositivo (ej. al hacer logout)
-- ============================================================================
-- Conveniencia simétrica a register_push_token(), para el caso "el usuario cierra sesión en
-- este dispositivo -- dejar de mandarle push acá". Igual que arriba, las policies de RLS ya
-- alcanzarían para que el cliente haga `.delete()` directo filtrando por `device`, pero se
-- expone la RPC para no requerir que el cliente conozca el `id` interno de la fila (le
-- alcanza con el `device` que ya tiene en secure storage).
create or replace function public.unregister_push_token(
  p_device text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_device is null or char_length(trim(p_device)) = 0 then
    raise exception 'device no puede estar vacío' using errcode = '22023'; -- invalid_parameter_value
  end if;

  delete from push_tokens
  where user_id = auth.uid()
    and device = p_device;
end;
$$;

comment on function public.unregister_push_token(text) is
  'PGM-10: borra (si existe) el push token del usuario autenticado para el dispositivo '
  'p_device -- pensado para invocarse al hacer logout en ese dispositivo. `security '
  'invoker`: sigue sujeta a push_tokens_delete_own, solo puede borrar sus propios tokens. '
  'No falla si no existe ninguna fila para ese device (delete de 0 filas es un no-op '
  'silencioso, comportamiento esperado de un "unregister" idempotente).';

revoke all on function public.unregister_push_token(text) from public;
grant execute on function public.unregister_push_token(text) to authenticated;
