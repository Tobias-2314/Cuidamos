-- PGM-12: [T5] Endpoint RGPD -- borrado total de datos de la familia (art. 17).
--
-- ============================================================================
-- ALCANCE ELEGIDO vs. la issue original -- desvíos deliberados, documentados acá
-- ============================================================================
--
-- 1) "Edge Function con doble confirmación" -> RPC `security definer` en su lugar.
--    Mismo criterio que PGM-11 (export_family_data, 20260915130000_export_family_data_rpc.sql):
--    este repo no tiene Edge Functions (`ls supabase/` -- no existe `supabase/functions/`).
--    La "doble confirmación" de la issue original es, en el diseño de esta RPC, DOS capas
--    independientes (ver sección de confirmación más abajo), no delegada a que el Frontend
--    haga una doble confirmación de UI antes de llamar -- ver esa sección para el detalle.
--
-- 2) Alcance de "quién puede invocar esto" -- DECISIÓN DE PRODUCTO EXPLÍCITAMENTE DIFERIDA.
--    La issue original menciona "manejo del caso último miembro vs. un miembro se va" como
--    parte del alcance. Esto NO se implementa acá a propósito: es una decisión de producto
--    real y no trivial (RGPD art. 17 es un derecho INDIVIDUAL -- que BORREN MIS datos, no
--    necesariamente que yo pueda borrar unilateralmente los datos compartidos de una familia
--    entera con otros miembros todavía activos). La issue no aclara qué debe pasar si un
--    cuidador que NO es el único miembro pide borrar SUS datos mientras la familia sigue
--    existiendo para los demás.
--
--    Alcance seguro implementado en esta iteración: `delete_family_data()` borra la FAMILIA
--    ENTERA (cascada completa) y puede ser invocada por CUALQUIER miembro de la familia (no
--    solo `families.created_by`) -- ver nota de diseño de seguridad más abajo sobre por qué
--    esto requiere `security definer` (la RLS de `families_delete_own` restringe el DELETE
--    real a `created_by = auth.uid()`, más restrictivo que "cualquier miembro").
--
--    NO IMPLEMENTADO, a propósito, y NO es lo mismo que lo de arriba: "un miembro individual
--    se va sin borrar la familia entera para los demás" (ej. remover únicamente su propia
--    fila de `family_members`, dejando la familia y los datos compartidos intactos para el
--    resto). Esa ya es una operación distinta -- de hecho ya existe parcialmente
--    (`family_members_delete_own`, PGM-15, permite a cualquier usuario borrar SU PROPIA fila
--    de `family_members` hoy) -- y decidir si además debe (a) borrar/anonimizar datos
--    creados por ese usuario específico dentro de la familia (medicaciones que registró,
--    notas que escribió, etc.) o (b) dejarlos intactos porque pertenecen al historial
--    compartido de cuidado de la familia, es una pregunta de producto que esta issue no
--    responde y que este agente NO va a inventar. Pendiente de decisión de Tech
--    Lead/Producto -- ver NOTES del agente.
--
-- 3) `audit_events` con hash del user_id -- NO implementado, misma razón que PGM-11: la
--    tabla `audit_events` no existe todavía (depende de PGM-13, issue de Backend pendiente).
--    PUNTO DE ENGANCHE FUTURO: cuando PGM-13 cree `audit_events`, agregar un
--    `insert into audit_events (...)` justo antes del `delete from families` de más abajo
--    (buscar el comentario "PGM-13: enganchar acá el log de auditoría" en el cuerpo de la
--    función) -- loguear el borrado ANTES de ejecutarlo (no después) para que quede
--    registrado aunque algo falle a mitad del cascade. Hasta entonces, esta RPC NO deja
--    ningún rastro de quién borró qué -- riesgo aceptado y documentado, ver NOTES.
--
-- 4) "Documentos del Storage" -- excluidos, no existe bucket (mismo criterio que PGM-11,
--    revisado `supabase/config.toml` y docs/product-vision.md de nuevo para esta issue).
--
-- ============================================================================
-- QUÉ SÍ borra (cascada completa, vía `on delete cascade` ya existente en las FK del
-- schema -- un único `delete from families` dispara todo lo de abajo, no hace falta borrar
-- tabla por tabla a mano):
-- ============================================================================
--   families (la fila raíz)
--   └─ family_members            (family_id -> families, on delete cascade, PGM-15)
--   └─ family_invitations        (family_id -> families, on delete cascade, PGM-19)
--   └─ cared_persons             (family_id -> families, on delete cascade, PGM-21)
--        └─ medical_contacts     (cared_person_id -> cared_persons, on delete cascade, PGM-21)
--        └─ emergency_contacts   (cared_person_id -> cared_persons, on delete cascade, PGM-21)
--        └─ medications          (cared_person_id -> cared_persons, on delete cascade, PGM-30)
--             └─ medication_logs (medication_id -> medications, on delete cascade, PGM-30)
--   └─ shifts                    (family_id -> families, on delete cascade, PGM-25)
--        └─ shift_handovers      (shift_id -> shifts, on delete cascade, PGM-35)
--
-- QUÉ NO borra, a propósito:
--   * `push_tokens`: NO tiene `family_id` (ver 20260915120000_push_tokens.sql) -- pertenece
--     al USUARIO, no a la familia (un usuario puede ser miembro de más de una familia, y su
--     token de push de su dispositivo no es un dato de la familia que se está borrando). La
--     issue original menciona "push_tokens" en la lista de cascada, pero eso no es
--     consistente con el propio diseño de esa tabla (PGM-10): borrar una familia no implica
--     que el usuario deje de existir ni que deba perder su registro de push. Se excluye acá
--     deliberadamente -- si en el futuro se agrega "borrado de MI cuenta completa" (distinto
--     de "borrado de la familia"), esa operación sí debería tocar push_tokens (ya cascadea
--     solo, vía `on delete cascade` de auth.users).
--   * Documentos de Storage: no hay bucket (ver punto 4 arriba).
--   * `auth.users`: esta función NUNCA borra usuarios. Borrar la familia no borra las
--     cuentas de sus miembros -- son personas que pueden seguir usando la app en otras
--     familias. Coherente con `families.created_by references auth.users on delete
--     restrict` (PGM-15): el modelo nunca asume que borrar datos de dominio borra cuentas.
--
-- ============================================================================
-- DISEÑO DE SEGURIDAD: por qué `security definer` (a diferencia de export_family_data)
-- ============================================================================
-- export_family_data (PGM-11) es `security invoker` porque las policies de SELECT de todas
-- las tablas relevantes ya permiten a cualquier miembro ver todas las filas de su familia.
-- Acá NO alcanza con `security invoker`, por dos motivos concretos:
--
--   1) `families_delete_own` (PGM-15) restringe el DELETE de `families` a
--      `created_by = auth.uid()` -- SOLO quien creó la familia. El alcance de esta issue
--      (ver punto 2 arriba) es que CUALQUIER miembro pueda invocar el borrado total, no solo
--      el creador. Bajo `security invoker`, un cuidador no-creador recibiría
--      `insufficient_privilege` de la propia RLS al intentar `delete from families`.
--   2) `family_members_delete_own` (PGM-15) solo permite a un usuario borrar SU PROPIA fila
--      de `family_members` -- el cascade de `families` hacia `family_members` no pasa por
--      esa policy (un `on delete cascade` de FK no está sujeto a las policies de DELETE de
--      la tabla hija cuando quien ejecuta el DELETE raíz bypasea RLS), pero si esta función
--      fuera `security invoker` sin bypass, el `delete from families` del punto 1 ya fallaría
--      antes de llegar a este problema.
--
-- Por eso esta función es `security definer`, con el mismo criterio de "bypass acotado y
-- 100% verificado adentro" que `is_family_member()` (PGM-25/PGM-4T3) y
-- `accept_family_invitation()` (PGM-19): el ÚNICO permiso nuevo que se expone al caller es
-- "borrar la familia entera de la que sos miembro" (verificado con `is_family_member()` al
-- inicio, ANTES de cualquier otra lógica) -- ningún caller puede usar esta función para
-- tocar una familia ajena, ni para nada que no sea ese borrado total.
--
-- ============================================================================
-- CONFIRMACIÓN EXPLÍCITA -- defensa en profundidad, NO delegada al Frontend
-- ============================================================================
-- La issue pide "doble confirmación". Se interpreta acá como una propiedad de la RPC en sí
-- (no solo de la UI que la llama, que de todos modos debería seguir teniendo su propia
-- doble confirmación -- eso es una decisión de UX de Frontend, ortogonal a esto). Un borrado
-- irreversible de este calibre no debe poder dispararse con una única llamada trivial de un
-- solo parámetro obvio (`p_family_id`). Esta RPC exige DOS parámetros de confirmación,
-- ambos obligatorios (sin default -- omitir cualquiera de los dos es un error de tipo/
-- faltante de PostgREST, ni siquiera llega a ejecutar el body):
--
--   1) `p_confirm boolean` -- debe ser exactamente `true`. Documentado explícitamente como
--      "NO es suficiente por sí solo": un booleano es fácil de hardcodear como `true` sin
--      pensarlo (ej. copy-paste de otro call site), así que por sí solo NO es una defensa
--      real contra un bug de Frontend que llame a esta función por error o con el
--      `p_family_id` equivocado. Es la capa que hace explícito "sí, quiero ejecutar la
--      variante destructiva de esta función" a nivel de firma.
--   2) `p_family_name_confirmation text` -- debe coincidir EXACTAMENTE (comparación
--      sensible a mayúsculas, sin trim implícito más que el trim explícito de abajo) con
--      `families.name` de la familia a borrar. Esta es la capa que sí aporta seguridad real:
--      obliga a que el caller haya leído/mostrado el nombre real de la familia (ej. en un
--      input de confirmación tipo "escribí el nombre de la familia para confirmar", patrón
--      común en operaciones destructivas) en el momento de la llamada, no solo a nivel de
--      UI/UX -- una llamada automatizada o un bug que dispare esta función con un
--      `p_family_id` incorrecto necesitaría ADEMÁS acertar el nombre exacto de esa otra
--      familia, algo que no pasa por accidente.
--
-- El chequeo de membresía (`is_family_member`) se hace ANTES que estos dos chequeos de
-- confirmación, a propósito: evita que alguien sin acceso a la familia use el mensaje de
-- error de "nombre no coincide" como oráculo para adivinar el nombre real de una familia
-- ajena (con la membresía verificada primero, ese camino ni siquiera es alcanzable).
--
-- `volatile` (no `stable`/`immutable`): a diferencia de export_family_data, esta función
-- escribe (borra).

create or replace function public.delete_family_data(
  p_family_id uuid,
  p_confirm boolean,
  p_family_name_confirmation text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  v_family_name text;
  v_counts jsonb;
  v_deleted_rows int;
begin
  if p_family_id is null then
    raise exception 'p_family_id es obligatorio' using errcode = '22023'; -- invalid_parameter_value
  end if;

  -- Chequeo de membresía PRIMERO -- ver nota de diseño arriba sobre por qué esto evita usar
  -- el resto de las validaciones (en particular el mensaje de "nombre no coincide") como
  -- oráculo para una familia ajena.
  if not is_family_member(p_family_id, auth.uid()) then
    raise exception 'No sos miembro de esta familia' using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Capa de confirmación 1/2 -- ver nota de diseño extensa arriba sobre por qué esto SOLO
  -- (sin la capa 2) no alcanzaría como defensa real.
  if p_confirm is distinct from true then
    raise exception
      'Borrado cancelado: p_confirm debe ser exactamente true para confirmar el borrado '
      'total e irreversible de la familia' using errcode = '22023';
  end if;

  select f.name into v_family_name
  from families f
  where f.id = p_family_id;

  if v_family_name is null then
    -- No debería alcanzarse nunca (is_family_member ya implica que la familia existe), pero
    -- se deja el check explícito por robustez ante una carrera concurrente (ej. dos llamadas
    -- a delete_family_data casi simultáneas para la misma familia).
    raise exception 'Familia no encontrada' using errcode = 'P0002'; -- no_data_found
  end if;

  -- Capa de confirmación 2/2 -- comparación exacta (case-sensitive), sin normalizar más que
  -- el trim de espacios al inicio/fin (mismo trim que exige el check de la columna
  -- `families.name` en 20260913203000_families_and_members.sql).
  if p_family_name_confirmation is null
     or trim(p_family_name_confirmation) is distinct from v_family_name then
    raise exception
      'Borrado cancelado: p_family_name_confirmation no coincide con el nombre de la '
      'familia -- repetí el nombre exacto para confirmar el borrado' using errcode = '22023';
  end if;

  -- Conteo de todo lo que se va a borrar, ANTES de borrarlo -- para que el Frontend pueda
  -- mostrar un resumen ("se borraron 3 medicaciones, 12 registros de toma, ...") en vez de
  -- solo `void`. Ver árbol completo de tablas en la nota de alcance al inicio de esta
  -- migración.
  select jsonb_build_object(
    'family_members', (
      select count(*) from family_members where family_id = p_family_id
    ),
    'family_invitations', (
      select count(*) from family_invitations where family_id = p_family_id
    ),
    'cared_persons', (
      select count(*) from cared_persons where family_id = p_family_id
    ),
    'medical_contacts', (
      select count(*)
      from medical_contacts mc
      join cared_persons cp on cp.id = mc.cared_person_id
      where cp.family_id = p_family_id
    ),
    'emergency_contacts', (
      select count(*)
      from emergency_contacts ec
      join cared_persons cp on cp.id = ec.cared_person_id
      where cp.family_id = p_family_id
    ),
    'medications', (
      select count(*)
      from medications m
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id = p_family_id
    ),
    'medication_logs', (
      select count(*)
      from medication_logs ml
      join medications m on m.id = ml.medication_id
      join cared_persons cp on cp.id = m.cared_person_id
      where cp.family_id = p_family_id
    ),
    'shifts', (
      select count(*) from shifts where family_id = p_family_id
    ),
    'shift_handovers', (
      select count(*)
      from shift_handovers sh
      join shifts s on s.id = sh.shift_id
      where s.family_id = p_family_id
    )
  )
  into v_counts;

  -- PGM-13: enganchar acá el log de auditoría (audit_events) cuando esa tabla exista -- ANTES
  -- del delete, no después, para que quede registro aunque algo falle a mitad del cascade.
  -- ej. `insert into audit_events (event, actor_id, family_id, created_at) values
  -- ('delete_family_data', auth.uid(), p_family_id, now());`. No implementado en esta issue
  -- (PGM-12) porque audit_events todavía no existe -- ver punto 3 de la nota de alcance al
  -- inicio de esta migración.

  -- El DELETE raíz -- todo lo demás cascadea vía FK `on delete cascade` ya existente (ver
  -- árbol completo en la nota de alcance). `security definer` bypasea tanto
  -- `families_delete_own` (que restringiría esto a created_by = auth.uid()) como cualquier
  -- policy de DELETE de las tablas hijas que el cascade dispare internamente.
  delete from families where id = p_family_id;

  get diagnostics v_deleted_rows = row_count;
  if v_deleted_rows <> 1 then
    raise exception 'No se pudo borrar la familia (fila no encontrada al momento del delete)'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deleted_family_id', p_family_id,
    'deleted_family_name', v_family_name,
    'deleted_at', now(),
    'deleted_by', auth.uid(),
    'deleted_counts', v_counts
  );
end;
$$;

comment on function public.delete_family_data(uuid, boolean, text) is
  'PGM-12: borrado total RGPD (art. 17) de una familia -- hard delete en cascada de '
  'family_members, family_invitations, cared_persons (con medical_contacts/'
  'emergency_contacts/medications/medication_logs anidados), shifts (con shift_handovers) y '
  'la propia familia, vía `on delete cascade` ya existente en el schema (ver árbol completo '
  'en el comentario de esta migración). `security definer` a propósito: permite que '
  'CUALQUIER miembro de la familia lo invoque (no solo families.created_by, que es a quien '
  'restringiría la RLS de DELETE de `families` bajo `security invoker`) -- con '
  '`is_family_member()` como único chequeo de autorización, verificado ANTES que cualquier '
  'otra cosa. Exige DOS confirmaciones explícitas obligatorias, ninguna suficiente por sí '
  'sola: p_confirm = true, y p_family_name_confirmation = nombre exacto de la familia (ver '
  'nota de diseño extensa en esta migración). Devuelve un resumen con conteos por tabla de '
  'lo borrado, no solo void. NO borra push_tokens (son del usuario, no de la familia) ni '
  'auth.users (esta función nunca borra cuentas). NO deja registro en audit_events -- esa '
  'tabla no existe todavía (PGM-13, pendiente); ver el comentario "PGM-13: enganchar acá" en '
  'el cuerpo de esta función. NO implementa "un miembro individual se va sin borrar la '
  'familia entera" -- decisión de producto explícitamente diferida, ver nota de alcance al '
  'inicio de esta migración y NOTES del agente que la escribió.';

revoke all on function public.delete_family_data(uuid, boolean, text) from public;
grant execute on function public.delete_family_data(uuid, boolean, text) to authenticated;
