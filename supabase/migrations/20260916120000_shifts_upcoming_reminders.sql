-- PGM-29: [BE] Notificación push/email de turno próximo -- mitad técnica verificable
-- (continuación directa de PGM-10, ver nota de alcance extensa en
-- supabase/migrations/20260915120000_push_tokens.sql).
--
-- ----------------------------------------------------------------------------------------
-- POR QUÉ ESTA MIGRACIÓN NO MANDA NINGÚN PUSH TODAVÍA (mismo bloqueante que dejó PGM-10)
-- ----------------------------------------------------------------------------------------
-- La issue original ("recordatorio de turno próximo vía push o email") requiere, además de
-- lo que esta migración entrega, dos cosas que siguen sin poder resolverse acá:
--   1. DECISIONES DE PRODUCTO no documentadas en docs/product-vision.md: cuántos minutos
--      antes de `shifts.starts_at` se debe avisar ("X minutos"), y el texto exacto del
--      mensaje push/email. Inventar esos valores sería adivinar -- quedan en NOTES del
--      agente para el Tech Lead, no en esta migración.
--   2. INFRAESTRUCTURA que no existe en el repo: no hay `supabase/functions/` (confirmado
--      con `ls supabase/` antes de escribir esta migración, igual que hizo PGM-10) para una
--      Edge Function `send_push` que llame a la API de Expo, y `pg_cron` NO está habilitado
--      como extensión (ver supabase/migrations/20260913171432_enable_extensions.sql: solo
--      `pgcrypto` y `uuid-ossp`) -- no hay ningún disparador periódico configurado.
--
-- Lo que SÍ es puramente técnico y verificable sin esas dos decisiones -- y es lo que
-- entrega esta migración -- es la LÓGICA DE CONSULTA "¿qué turnos empiezan pronto y todavía
-- no recibieron recordatorio?" más un helper de solo lectura que arma "a quién y con qué
-- turno habría que notificar", dejando el envío real (Edge Function + pg_cron + copy del
-- mensaje + valor de X minutos) para una issue futura una vez que producto decida esos
-- valores. Mismo criterio que PGM-10 ya documentó y aplicó.
--
-- ----------------------------------------------------------------------------------------
-- DISEÑO: "ya se le avisó a este turno" -- columna en `shifts`, no tabla separada
-- ----------------------------------------------------------------------------------------
-- Se evaluaron las dos opciones que pide la issue:
--   (a) columna `reminder_sent_at timestamptz` en `shifts` (nullable).
--   (b) tabla separada `shift_reminders` (shift_id, sent_at, ...).
--
-- Se elige (a) por estas razones:
--   * La relación es 1:1 por diseño: un turno tiene A LO SUMO un recordatorio de "turno
--     próximo" (a diferencia de `medication_logs`, donde una medicación tiene MUCHAS tomas
--     a lo largo del tiempo y por eso sí amerita tabla propia). No hay necesidad de
--     historial de reintentos en el alcance actual -- YAGNI: si en el futuro aparece un
--     caso de uso real de "reenviar recordatorio" o "recordatorio a distintos umbrales de
--     minutos con reintentos", eso sí justificaría una tabla; hoy no hay ese caso.
--   * Encaja con el patrón ya usado en este dominio para "marca de estado puntual sobre una
--     fila existente" (ej. `shifts.status`), en vez de introducir una tabla nueva con su
--     propia RLS solo para un booleano-con-fecha.
--   * Guardar el TIMESTAMP (no un boolean) permite debug ("¿cuándo se marcó?") y deja la
--     puerta abierta a una futura limpieza/expiración sin cambiar el tipo de dato.
--   * Nullable, sin default: `null` significa "todavía no se le avisó" -- estado inicial de
--     todo turno existente y nuevo, sin necesidad de un backfill.
--
-- Caso NO cubierto a propósito (documentado, no resuelto acá): si un turno se reprograma
-- (`starts_at` cambia) DESPUÉS de que ya se marcó `reminder_sent_at`, esta migración no
-- resetea la marca automáticamente -- decidir si un turno reprogramado debe volver a
-- notificarse es, otra vez, una decisión de PRODUCTO (¿se reenvía siempre? ¿solo si el
-- nuevo horario está a más de X minutos del original?) que no está definida. Se deja
-- anotado en NOTES del agente como caso pendiente para cuando se defina el flujo completo.

alter table shifts
  add column reminder_sent_at timestamptz;

comment on column shifts.reminder_sent_at is
  'PGM-29: marca de "ya se envió el recordatorio de turno próximo" para este turno. NULL '
  '= todavía no se le avisó (estado inicial). Se fija con mark_shift_reminder_sent(), '
  'pensada para ser llamada por la futura Edge Function/cron DESPUÉS de un envío exitoso '
  '-- esta migración no envía nada, solo deja la marca disponible. Columna en vez de tabla '
  'separada a propósito: relación 1:1 turno-recordatorio, sin necesidad de historial de '
  'reintentos en el alcance actual (YAGNI) -- ver nota de diseño extensa en esta migración '
  '(20260916120000_shifts_upcoming_reminders.sql). NO se resetea automáticamente si '
  '`starts_at` cambia tras una reprogramación -- caso pendiente de decisión de producto, '
  'ver NOTES del agente que implementó PGM-29.';

-- Índice parcial pensado para el patrón de consulta de get_shifts_needing_upcoming_reminder:
-- "turnos agendados, sin recordatorio enviado, ordenados/filtrados por starts_at" -- el
-- `where reminder_sent_at is null` lo hace angosto (excluye turnos ya notificados, que con
-- el tiempo van a ser la mayoría de las filas históricas).
create index shifts_pending_reminder_idx
  on shifts (starts_at)
  where reminder_sent_at is null and status = 'scheduled';

comment on index shifts_pending_reminder_idx is
  'PGM-29: índice parcial para get_shifts_needing_upcoming_reminder() -- angosto a '
  'propósito (solo turnos scheduled sin recordatorio enviado), que es el subconjunto que '
  'esa función escanea en cada corrida futura del cron.';

-- ============================================================================
-- get_shifts_needing_upcoming_reminder(): lógica pura de "qué turnos califican"
-- ============================================================================
-- Devuelve los turnos que:
--   1. Empiezan dentro de los próximos `p_minutes_ahead` minutos (y no empezaron ya --
--      `starts_at > now()`, para no re-notificar turnos que ya arrancaron).
--   2. Siguen en estado 'scheduled' -- un turno cancelado o que ya pasó a in_progress/
--      completed no necesita un recordatorio de "está por empezar".
--   3. Todavía no tienen `reminder_sent_at` (no se le avisó antes).
--
-- `security definer`, NO `security invoker`: a propósito, y es la única función de este
-- dominio que lo hace por esta razón puntual -- el caso de uso es un escaneo GLOBAL de
-- TODAS las familias ("¿qué turnos de CUALQUIER familia empiezan pronto?"), pensado para
-- ser invocado por la futura Edge Function/cron corriendo con la service_role key (o por
-- pg_cron corriendo como `postgres`), nunca por un cliente logueado como un usuario común.
-- Si fuera `security invoker`, la RLS de `shifts_select_member` limitaría el resultado a
-- los turnos de las familias del CALLER -- que es exactamente lo que NO se necesita acá (un
-- proceso de sistema, no un usuario, es quien pregunta). Por eso el `grant execute` de más
-- abajo es a `service_role` ÚNICAMENTE, nunca a `authenticated` -- ver esa sección para el
-- detalle de por qué exponerla al cliente sería una fuga de datos entre familias.
create or replace function public.get_shifts_needing_upcoming_reminder(p_minutes_ahead int)
returns table (
  shift_id uuid,
  family_id uuid,
  assigned_to uuid,
  cared_person_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    s.id,
    s.family_id,
    s.assigned_to,
    s.cared_person_id,
    s.starts_at,
    s.ends_at
  from shifts s
  where s.status = 'scheduled'
    and s.reminder_sent_at is null
    and s.starts_at > now()
    and s.starts_at <= now() + make_interval(mins => greatest(p_minutes_ahead, 0))
  order by s.starts_at asc;
$$;

comment on function public.get_shifts_needing_upcoming_reminder(int) is
  'PGM-29: turnos scheduled, sin recordatorio enviado, que empiezan dentro de los próximos '
  'p_minutes_ahead minutos (y no empezaron ya). `security definer` a propósito -- escaneo '
  'GLOBAL entre familias, pensado para la futura Edge Function/cron corriendo con '
  'service_role, NUNCA para un cliente autenticado común (ver `grant` más abajo, solo a '
  'service_role). p_minutes_ahead <= 0 se trata como 0 (greatest(...,0)), sin lanzar error, '
  'para que un valor mal pasado devuelva simplemente 0 filas en vez de comportarse como '
  '"todos los turnos futuros" con un intervalo negativo. NO envía nada -- es lógica de '
  'consulta pura, el valor final de X minutos y el disparo del cron son decisiones/trabajo '
  'pendientes, ver NOTES del agente que implementó PGM-29.';

-- Nota: `revoke ... from public` NO alcanza acá -- a diferencia de las tablas (donde el
-- resto del dominio se apoya en los grants por default de Supabase sobre PUBLIC), Supabase
-- aplica `alter default privileges` que otorga EXECUTE DIRECTAMENTE a los roles
-- `anon`/`authenticated`/`service_role` (no vía el pseudo-rol PUBLIC) sobre toda función
-- nueva en el schema `public` -- verificado empíricamente contra el stack local
-- (`select proacl from pg_proc where proname = 'get_shifts_needing_upcoming_reminder'`
-- mostraba `authenticated=X/postgres` pese al `revoke ... from public`). Por eso acá se
-- revoca explícitamente de `anon` y `authenticated` además de `public`, algo que ninguna
-- otra función de este repo necesitó porque ninguna otra es service_role-only.
revoke all on function public.get_shifts_needing_upcoming_reminder(int) from public, anon, authenticated;
grant execute on function public.get_shifts_needing_upcoming_reminder(int) to service_role;

-- ============================================================================
-- mark_shift_reminder_sent(): marca un turno como "ya avisado", para que no se reenvíe
-- ============================================================================
-- Simétrica a get_shifts_needing_upcoming_reminder(): pensada para que la futura Edge
-- Function/cron la invoque DESPUÉS de confirmar un envío exitoso (o un intento, según
-- decida esa issue futura) para un turno puntual. `security definer` por el mismo motivo
-- que la función de arriba -- el proceso que marca "ya avisado" no es necesariamente
-- miembro de la familia del turno (es un proceso de sistema), así que `security invoker`
-- lo bloquearía por shifts_update_member. Grant solo a `service_role`, mismo criterio.
create or replace function public.mark_shift_reminder_sent(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update shifts
  set reminder_sent_at = now()
  where id = p_shift_id;

  if not found then
    raise exception 'shift % no encontrado' , p_shift_id using errcode = 'P0002'; -- no_data_found
  end if;
end;
$$;

comment on function public.mark_shift_reminder_sent(uuid) is
  'PGM-29: marca shifts.reminder_sent_at = now() para el turno indicado, para que '
  'get_shifts_needing_upcoming_reminder() no lo vuelva a devolver en corridas futuras. '
  '`security definer`, grant solo a service_role -- pensada para ser llamada por la futura '
  'Edge Function/cron después de un envío (exitoso o intentado, decisión de esa issue '
  'futura), no por un cliente autenticado. Lanza P0002 (no_data_found) si el shift_id no '
  'existe, para que el caller (la futura Edge Function) note el error en vez de un '
  'no-op silencioso.';

-- Mismo caveat que get_shifts_needing_upcoming_reminder() -- ver nota extensa ahí.
revoke all on function public.mark_shift_reminder_sent(uuid) from public, anon, authenticated;
grant execute on function public.mark_shift_reminder_sent(uuid) to service_role;

-- ============================================================================
-- get_upcoming_shift_reminder_targets(): "a quién y con qué turno habría que notificar"
-- ============================================================================
-- Helper de SOLO LECTURA que junta get_shifts_needing_upcoming_reminder() con los
-- push_tokens del `assigned_to` de cada turno -- exactamente lo que pide el punto 2 de esta
-- issue ("sin enviar nada -- solo armar a quién y con qué turno habría que notificar").
-- NO envía nada, NO llama a ninguna API externa, NO decide el texto del mensaje.
--
-- LEFT JOIN a push_tokens (no INNER JOIN) a propósito: un turno puede calificar para
-- recordatorio aunque el cuidador asignado no tenga ningún push_token registrado todavía
-- (ej. nunca abrió la app en ese dispositivo, o rechazó permisos de notificaciones). Con
-- INNER JOIN ese turno directamente desaparecería del resultado y nadie se enteraría de
-- que "hay un turno próximo sin ninguna forma de notificar" -- con LEFT JOIN, la fila
-- aparece con expo_token/device/platform en NULL, dejando que el caller (la futura Edge
-- Function) decida qué hacer (ej. intentar el canal email de la issue original, que esta
-- migración no implementa, o solo loguear que no hay forma de avisar). Si el mismo usuario
-- tiene push_tokens en varios dispositivos, la fila del turno se repite una vez por
-- dispositivo (mismo criterio que "notificar todos los dispositivos donde el usuario tiene
-- la app instalada" -- comportamiento esperado, no un bug de fan-out).
--
-- `security definer`, grant solo a service_role: mismo motivo que las dos funciones de
-- arriba (escaneo global entre familias) MÁS el hecho de que expone `expo_token`, un
-- identificador de entrega de push que ningún miembro de la familia (aparte del dueño del
-- token) debería poder leer -- ver push_tokens_select_own (PGM-10). Un cliente autenticado
-- normal nunca debe poder ejecutar esta función.
create or replace function public.get_upcoming_shift_reminder_targets(p_minutes_ahead int)
returns table (
  shift_id uuid,
  family_id uuid,
  assigned_to uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  device text,
  expo_token text,
  platform text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    s.shift_id,
    s.family_id,
    s.assigned_to,
    s.starts_at,
    s.ends_at,
    pt.device,
    pt.expo_token,
    pt.platform
  from get_shifts_needing_upcoming_reminder(p_minutes_ahead) s
  left join push_tokens pt on pt.user_id = s.assigned_to
  order by s.starts_at asc;
$$;

comment on function public.get_upcoming_shift_reminder_targets(int) is
  'PGM-29: junta get_shifts_needing_upcoming_reminder() con los push_tokens del '
  'assigned_to de cada turno -- "a quién y con qué turno habría que notificar", sin enviar '
  'nada. LEFT JOIN a propósito: un turno sin ningún push_token registrado para su '
  'assigned_to igual aparece (con device/expo_token/platform en NULL), para no esconder '
  'que ese cuidador no tiene forma de recibir push -- ver nota extensa arriba. Una fila por '
  '(turno, dispositivo) si el cuidador tiene varios push_tokens. `security definer`, grant '
  'solo a service_role -- expone expo_token entre familias, nunca debe ser ejecutable por '
  'un cliente autenticado común. NO es la Edge Function send_push -- eso sigue pendiente, '
  'ver NOTES del agente que implementó PGM-29.';

-- Mismo caveat que get_shifts_needing_upcoming_reminder() -- ver nota extensa ahí.
revoke all on function public.get_upcoming_shift_reminder_targets(int) from public, anon, authenticated;
grant execute on function public.get_upcoming_shift_reminder_targets(int) to service_role;
