-- PGM-34: [BE] Notificación de medicación pendiente/no marcada -- mitad "medicación" de F6
-- (la mitad "turno próximo" es PGM-29, ver supabase/migrations/20260916120000_shifts_upcoming_reminders.sql).
--
-- ==========================================================================================
-- BLOQUEANTE DE DATOS -- MÁS PROFUNDO QUE EL DE PGM-29, NO RESUELTO EN ESTA MIGRACIÓN
-- ==========================================================================================
-- PGM-29 pudo construir lógica de consulta real ("¿qué turnos empiezan pronto y no fueron
-- avisados?") porque `shifts.starts_at` es un timestamp estructurado: comparar contra
-- `now()` es aritmética de fechas simple y correcta.
--
-- Esta issue pide lo equivalente para medicación: "¿qué medicación DEBERÍA haberse tomado a
-- tal hora y no se marcó?". Para responder eso hace falta, como mínimo, poder calcular
-- "¿cuál es la próxima hora en que correspondía tomar esta medicación?" -- y esa pregunta NO
-- tiene respuesta con el modelo de datos actual.
--
-- `medications.schedule` es texto libre A PROPÓSITO (decisión YAGNI ya documentada en
-- supabase/migrations/20260913240000_medications.sql, columna `schedule`): valores reales
-- como "cada 8 horas", "08:00, 14:00, 22:00" o "con el desayuno" no tienen una gramática
-- fija. No existe ninguna columna estructurada (a diferencia de `shifts.starts_at`) que
-- diga "la próxima toma es a las 14:32" sin parsear ese texto libre.
--
-- Por qué esta migración NO intenta resolverlo de todos modos:
--   1. Parsear texto libre con una heurística ("si contiene 'cada N horas', asumir
--      intervalo fijo desde la última toma; si contiene una lista de horas, parsear con
--      regex...") sería FRÁGIL y probablemente incorrecto para una fracción real de
--      formatos que los cuidadores escriban en producción -- generaría falsos "vencida" (el
--      cuidador SÍ la dio pero el parser no entendió el horario) y falsos negativos
--      (nunca avisa porque el formato no matcheó ningún patrón conocido). Para una
--      notificación de salud ("esta medicación no se dio"), un falso positivo sistemático
--      rompe la confianza en la alerta y un falso negativo sistemático es peor que no tener
--      la feature.
--   2. Restructurar `schedule` a un formato con horas explícitas (ej. `time[]` para horas
--      fijas del día, o un intervalo `interval` para "cada N horas", o ambos) es la
--      migración de datos que PGM-30 evaluó y descartó por YAGNI en su momento -- y esa
--      decisión (¿vale la pena romperla ahora? ¿qué estructura exacta hace falta: horas del
--      día, intervalo, ambas, con qué UI de carga?) es de Producto/Tech Lead, no de esta
--      iteración de Backend. Proponer yo mismo esa migración sería tomar una decisión de
--      modelado de datos disfrazada de código.
--
-- Conclusión: PGM-34, tal como está redactada ("medicación pendiente o no marcada como
-- dada" -- es decir, vencida respecto de un horario), NO puede resolverse hoy sin que
-- Producto/Tech Lead decida cómo estructurar `schedule`. Este hallazgo es el entregable
-- principal de esta iteración.
--
-- ------------------------------------------------------------------------------------------
-- LO ÚNICO QUE SE CONSTRUYE ACÁ: UN PROXY DÉBIL QUE NO REQUIERE PARSEAR NADA
-- ------------------------------------------------------------------------------------------
-- `get_medications_never_logged()` devuelve medicaciones que, desde su creación, NUNCA
-- tuvieron NINGÚN `medication_log` -- ni uno solo, sin importar cuándo. No usa `schedule`
-- en absoluto, así que no hereda ninguno de los riesgos de parseo de arriba.
--
-- ADVERTENCIA EXPLÍCITA -- esto NO es lo que pide la issue:
--   * La issue pide "no marcada A TIEMPO" (una toma puntual vencida respecto de un
--     horario). Esta función detecta "jamás se registró NINGUNA toma, nunca" -- un proxy
--     mucho más débil y de un solo uso por medicación: apenas se registra el PRIMER log
--     (aunque sea tarde, aunque sea una sola vez y después se vuelva a olvidar
--     sistemáticamente), la medicación deja de aparecer para siempre en este resultado. No
--     detecta "se te olvidó la toma de las 22:00 de hoy" para una medicación que sí tiene
--     historial previo -- ESO sigue bloqueado por el problema de arriba.
--   * Sirve, como mucho, para un caso mucho más angosto: "se cargó una medicación y jamás
--     se le registró ninguna toma" (ej. se dio de alta y se abandonó, o un error de carga).
--     Es un chequeo de salud del registro, no un recordatorio de dosis vencida.
--   * `p_min_age` es un parámetro genérico que decide el LLAMADOR (no un valor derivado de
--     `schedule`) para dar margen antes de considerar "sin ninguna toma" -- evita marcar
--     como sospechosa una medicación creada hace 2 minutos que todavía no tuvo tiempo de
--     recibir su primera toma. No es una suposición sobre la cadencia real de esa
--     medicación en particular.
--
-- Mismo criterio de scope-splitting que PGM-29: esta función NO envía nada (ni push ni
-- email) -- es lógica de consulta pura, pensada para una futura Edge Function/cron una vez
-- que exista esa infraestructura (`supabase/functions/` sigue sin existir -- confirmado con
-- `ls supabase/` antes de escribir esta migración) y que Producto decida el copy y la
-- cadencia de aviso.

-- ============================================================================
-- get_medications_never_logged(): medicaciones sin NINGÚN medication_log jamás
-- ============================================================================
-- `security definer`, NO `security invoker` -- mismo motivo que
-- get_shifts_needing_upcoming_reminder() (PGM-29): escaneo GLOBAL entre TODAS las familias,
-- pensado para un futuro proceso de sistema (Edge Function/cron corriendo con
-- service_role), nunca para un cliente autenticado normal. Si fuera `security invoker`, la
-- RLS de `medications_select_member` limitaría el resultado a las medicaciones de las
-- familias del CALLER -- lo opuesto de lo que necesita un escaneo de sistema.
--
-- p_min_age: intervalo mínimo desde `created_at` antes de considerar que "ya tuvo tiempo
-- de recibir una primera toma y no la tiene". Sin default a propósito -- que el LLAMADOR
-- decida el margen explícitamente en vez de que esta función asuma uno.
create or replace function public.get_medications_never_logged(p_min_age interval)
returns table (
  medication_id uuid,
  family_id uuid,
  cared_person_id uuid,
  created_by uuid,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    m.id,
    cp.family_id,
    m.cared_person_id,
    m.created_by,
    m.created_at
  from medications m
  join cared_persons cp on cp.id = m.cared_person_id
  where m.created_at <= now() - p_min_age
    and not exists (
      select 1 from medication_logs ml where ml.medication_id = m.id
    )
  order by m.created_at asc;
$$;

comment on function public.get_medications_never_logged(interval) is
  'PGM-34: PROXY DÉBIL -- devuelve medicaciones creadas hace más de p_min_age que NUNCA '
  'tuvieron ningún medication_log, sin importar cuándo. NO es "no marcada a tiempo respecto '
  'de un horario" (eso pide la issue original) -- ver nota de diagnóstico extensa en esta '
  'migración (20260916130000_medications_never_logged.sql) sobre por qué eso sigue '
  'bloqueado: medications.schedule es texto libre a propósito (YAGNI de PGM-30) y no hay '
  'forma segura de calcular "próxima toma esperada" sin parsearlo, lo cual sería frágil. '
  'Esta función deja de devolver una medicación apenas se registra su PRIMER log, aunque '
  'después se vuelvan a olvidar tomas sistemáticamente -- uso previsto: detectar '
  'medicaciones dadas de alta y nunca registradas, no reemplazar un recordatorio de dosis '
  'puntual. `security definer`, grant solo a service_role -- escaneo global entre familias, '
  'igual criterio que get_shifts_needing_upcoming_reminder() (PGM-29). No envía nada.';

-- Mismo caveat que las funciones service_role-only de PGM-29 (ver nota extensa en
-- 20260916120000_shifts_upcoming_reminders.sql): Supabase otorga EXECUTE directamente a
-- anon/authenticated vía `alter default privileges`, no solo a través de PUBLIC, así que
-- hay que revocar de los tres explícitamente.
revoke all on function public.get_medications_never_logged(interval) from public, anon, authenticated;
grant execute on function public.get_medications_never_logged(interval) to service_role;
