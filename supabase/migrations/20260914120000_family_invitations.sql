-- PGM-19: Endpoint/función para aceptar invitación y unirse a familia.
--
-- CONTEXTO -- por qué esta migración también crea el mecanismo de invitación (no solo
-- "aceptar"):
-- El título de la issue es "aceptar invitación", pero al momento de implementarla NO existe
-- ningún mecanismo de invitación en el repo (ni tabla, ni token, ni función para crearla) --
-- confirmado con grep sobre "invit" en supabase/ y src/, la única mención previa es un
-- comentario en 20260913203000_families_and_members.sql explicando que falta. Sin una forma
-- de CREAR una invitación no hay nada que aceptar ni manera de testear el flujo end-to-end.
-- Alcance elegido (lo mínimo para que "aceptar" funcione y sea testeable, sin construir UI
-- ni notificaciones por email -- eso es PGM-18, Frontend, bloqueada esperando esta issue):
--   1) Tabla `family_invitations`: token + expiración + estado de uso.
--   2) `create_family_invitation(p_family_id, p_invited_email, p_ttl)`: crea el token.
--   3) `accept_family_invitation(p_token)`: valida y une al cuidador a la familia.
--
-- BLOQUEANTE DE RLS que esta migración resuelve (ver nota de diseño en
-- 20260913203000_families_and_members.sql, líneas 6-23): `family_members_insert_self_as_creator`
-- SOLO permite que el creador de la familia se auto-inserte. Ningún otro usuario tiene hoy
-- forma de unirse a una familia, con o sin invitación. `accept_family_invitation()` resuelve
-- esto con `security definer` (bypasea esa policy de forma controlada, con todos los checks
-- de validez del token adentro), siguiendo el mismo patrón ya establecido por
-- `is_family_member()` (PGM-25/PGM-4T3) para necesidades legítimas de bypass acotado.
--
-- Diseño de `family_invitations`:
--   - `token`: uuid random (`gen_random_uuid()`, pgcrypto ya habilitado en
--     20260913171432_enable_extensions.sql) -- no necesita ser humanamente legible, viaja en
--     un link/deep-link que arma el Frontend (PGM-18).
--   - `invited_email`: opcional. Guardado solo a título informativo/UI (ej. "invitación
--     pendiente para fulano@mail.com" en la pantalla de PGM-18) -- NO se valida contra el
--     email del usuario que acepta. Decisión explícita: exigir que el email de auth.users
--     coincida con invited_email agregaría fricción (¿qué pasa si la familia invita a un
--     email y la persona acepta logueada con otro?) sin pedido de producto que lo respalde;
--     el control de acceso real es el token random, no el email.
--   - `expires_at`: ver `family_invitation_default_ttl()` más abajo -- 7 días por default,
--     documentado como constante en vez de un literal repetido sin explicación.
--   - `used_at`/`used_by`: marca de uso. Una vez seteado `used_at`, el token queda inerte
--     (no reusable) -- ver checks en `accept_family_invitation()`.
--   - `created_by`: quien generó la invitación (debe ser admin de la familia, ver policy de
--     INSERT más abajo).

create table family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  invited_email text check (invited_email is null or char_length(trim(invited_email)) > 0),
  created_by uuid not null references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((used_at is null) = (used_by is null))
);

comment on table family_invitations is
  'PGM-19: invitación para que un cuidador se una a una familia existente. El token '
  '(uuid random) es la credencial real -- viaja en un link armado por el Frontend (PGM-18). '
  'used_at/used_by marcan la invitación como consumida (no reusable) tras un accept exitoso.';

comment on column family_invitations.invited_email is
  'Informativo únicamente (para mostrar "invitación pendiente para X" en la UI de PGM-18) '
  '-- accept_family_invitation() NO valida que el email de quien acepta coincida con este '
  'campo. El control de acceso real es el token random, ver nota de diseño en esta migración.';

comment on column family_invitations.expires_at is
  'Vencimiento del token. Default: now() + family_invitation_default_ttl() (7 días) -- ver '
  'esa función para el porqué de la constante en vez de un literal repetido.';

comment on column family_invitations.used_at is
  'NULL mientras la invitación está pendiente. Seteado por accept_family_invitation() al '
  'aceptarse -- a partir de ahí el token queda inerte, ver check de validez en esa función.';

create index family_invitations_family_id_idx on family_invitations (family_id);

-- Índice adicional para la búsqueda por token en accept_family_invitation() -- aunque el
-- `unique` de arriba ya crea un índice, se documenta explícitamente por qué existe (lookup
-- de alta frecuencia relativa: cada intento de aceptar invitación pasa por acá).
comment on constraint family_invitations_token_key on family_invitations is
  'El índice único sobre token es también el índice de lookup que usa '
  'accept_family_invitation() -- no se crea un índice separado a propósito, sería duplicado.';

alter table family_invitations enable row level security;

-- ============================================================================
-- family_invitation_default_ttl(): constante documentada, no un literal repetido
-- ============================================================================
-- 7 días es un default razonable y común para este tipo de flujo (ver NOTES del agente para
-- el razonamiento de producto). Se expresa como función `immutable` en vez de repetir
-- `interval '7 days'` en el default de la columna y en el parámetro de
-- `create_family_invitation()` -- un único lugar para cambiar el valor si el Tech Lead
-- decide otro TTL.
create or replace function family_invitation_default_ttl()
returns interval
language sql
immutable
as $$
  select interval '7 days';
$$;

comment on function family_invitation_default_ttl() is
  'PGM-19: TTL default de una invitación de familia (7 días). Constante centralizada -- '
  'usada como default tanto en family_invitations.expires_at como en el parámetro p_ttl de '
  'create_family_invitation(), para no repetir el literal sin explicación en dos lugares.';

alter table family_invitations
  alter column expires_at set default (now() + family_invitation_default_ttl());

-- family_invitations: solo un admin de la familia puede ver las invitaciones de esa familia
-- (ej. para que PGM-18 muestre "invitación pendiente, vence en N días"). Mismo patrón no
-- recursivo que el resto del dominio: consulta family_members, una tabla distinta.
create policy family_invitations_select_admin
  on family_invitations for select
  using (
    exists (
      select 1 from family_members fm
      where fm.family_id = family_invitations.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  );

-- family_invitations: solo un admin de la familia puede crear invitaciones para ella, y solo
-- a nombre de sí mismo (created_by = auth.uid()). `create_family_invitation()` es
-- `security invoker` (ver más abajo) -- esta policy es la que realmente autoriza el INSERT,
-- la función solo es una conveniencia que calcula token/expires_at.
--
-- Nota sobre el check de "admin": se acepta tanto quien tiene role = 'admin' en
-- family_members COMO quien figura como families.created_by, por robustez -- hoy
-- `family_members_insert_self_as_creator` (PGM-15) no fuerza a nivel de DB que el creador
-- se auto-inserte con role = 'admin' (ese valor lo manda el cliente), así que apoyarse
-- únicamente en role = 'admin' sería frágil si algún dato existente no lo respeta.
create policy family_invitations_insert_admin
  on family_invitations for insert
  with check (
    created_by = auth.uid()
    and (
      exists (
        select 1 from family_members fm
        where fm.family_id = family_invitations.family_id
          and fm.user_id = auth.uid()
          and fm.role = 'admin'
      )
      or exists (
        select 1 from families f
        where f.id = family_invitations.family_id
          and f.created_by = auth.uid()
      )
    )
  );

-- No hay policies de UPDATE/DELETE para el rol `authenticated` en esta issue: marcar una
-- invitación como usada es responsabilidad exclusiva de accept_family_invitation()
-- (`security definer`, bypasea RLS de forma controlada). Revocar/reenviar invitaciones
-- pendientes no fue pedido por esta issue -- YAGNI, se agrega cuando haya un caso de uso
-- confirmado (ver NOTES del agente).
--
-- Sin `revoke`/`grant` explícitos a nivel de tabla acá -- mismo criterio que
-- families/family_members/shifts/medications (ninguna de esas migraciones los usa): se
-- apoya en los grants por default de Supabase para `authenticated` sobre el schema `public`
-- más las policies de RLS de arriba, que son las que hacen el control de acceso real.

-- ============================================================================
-- create_family_invitation(): crea una invitación para unirse a la familia
-- ============================================================================
-- `security invoker`: NO amplía permisos -- el INSERT sigue sujeto íntegramente a
-- family_invitations_insert_admin (arriba). Esta función es solo una conveniencia para que
-- el cliente no tenga que calcular expires_at ni pasar created_by (siempre auth.uid()).
create or replace function public.create_family_invitation(
  p_family_id uuid,
  p_invited_email text default null,
  p_ttl interval default family_invitation_default_ttl()
)
returns table (
  token uuid,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_ttl is null or p_ttl <= interval '0' then
    raise exception 'p_ttl debe ser un intervalo positivo';
  end if;

  return query
  insert into family_invitations (family_id, invited_email, created_by, expires_at)
  values (p_family_id, p_invited_email, auth.uid(), now() + p_ttl)
  returning family_invitations.token, family_invitations.expires_at;
end;
$$;

comment on function public.create_family_invitation(uuid, text, interval) is
  'PGM-19: crea una invitación para unirse a p_family_id, devuelve (token, expires_at) para '
  'que el Frontend (PGM-18) arme el link/deep-link a compartir. `security invoker`: el '
  'INSERT sigue sujeto a family_invitations_insert_admin -- si quien llama no es '
  'admin/creador de la familia, falla con insufficient_privilege (RLS), esta función no '
  'evita ese check. p_ttl default family_invitation_default_ttl() (7 días).';

revoke all on function public.create_family_invitation(uuid, text, interval) from public;
grant execute on function public.create_family_invitation(uuid, text, interval) to authenticated;

-- ============================================================================
-- accept_family_invitation(): valida el token y une al cuidador a la familia
-- ============================================================================
-- `security definer` a propósito: family_members_insert_self_as_creator (PGM-15) NO permite
-- que un usuario que no es el creador de la familia se auto-inserte en family_members, así
-- que aceptar una invitación real (el caso central de esta issue) necesita bypasear esa
-- policy de forma controlada -- con TODOS los checks de validez del token hechos adentro de
-- la función, antes de tocar family_members. Mismo criterio de "bypass acotado y
-- verificado" que is_family_member() (PGM-25/PGM-4T3): no se expone ningún permiso nuevo al
-- caller más allá de "unirse a la familia de una invitación válida que él mismo posee".
--
-- `for update` sobre la fila de family_invitations: evita que dos requests concurrentes con
-- el mismo token (ej. doble click, o un link abierto en dos pestañas) pasen ambos el check
-- de "no usado" antes de que cualquiera de los dos marque used_at -- el segundo espera el
-- lock y encuentra la fila ya marcada como usada.
create or replace function public.accept_family_invitation(p_token uuid)
returns table (
  family_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation family_invitations%rowtype;
  v_role constant text := 'cuidador';
begin
  if p_token is null then
    raise exception 'p_token es obligatorio';
  end if;

  select * into v_invitation
  from family_invitations
  where token = p_token
  for update;

  if not found then
    raise exception 'La invitación no existe o el token es inválido';
  end if;

  if v_invitation.used_at is not null then
    raise exception 'Esta invitación ya fue utilizada';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'Esta invitación expiró el %', v_invitation.expires_at;
  end if;

  -- Aislamiento: no se puede aceptar una invitación de una familia de la que ya se es
  -- miembro. El unique (family_id, user_id) de family_members ya lo cubriría a nivel de DB,
  -- pero acá se chequea antes para devolver un mensaje legible en vez de un
  -- unique_violation crudo -- y el bloque exception de abajo cubre igual la carrera
  -- concurrente (ej. dos invitaciones a la misma familia aceptadas casi al mismo tiempo).
  if is_family_member(v_invitation.family_id, auth.uid()) then
    raise exception 'Ya sos miembro de esta familia';
  end if;

  begin
    insert into family_members (family_id, user_id, role)
    values (v_invitation.family_id, auth.uid(), v_role);
  exception
    when unique_violation then
      raise exception 'Ya sos miembro de esta familia';
  end;

  update family_invitations
  set used_at = now(), used_by = auth.uid()
  where family_invitations.id = v_invitation.id;

  return query select v_invitation.family_id, v_role;
end;
$$;

comment on function public.accept_family_invitation(uuid) is
  'PGM-19: valida un token de invitación (existe, no usado, no expirado) y une a auth.uid() '
  'a family_invitations.family_id como role = ''cuidador'', marcando la invitación como '
  'usada. `security definer` a propósito -- bypasea family_members_insert_self_as_creator '
  '(PGM-15), que hoy solo permite auto-insertarse al creador de la familia, con todos los '
  'checks de validez del token hechos adentro de la función. No expone ningún permiso nuevo '
  'más allá de "unirse a la familia de una invitación válida propia". Rechaza con un mensaje '
  'legible (no un error crudo de constraint) si el token es inválido/expirado/ya usado, o si '
  'quien acepta ya es miembro de esa familia.';

revoke all on function public.accept_family_invitation(uuid) from public;
grant execute on function public.accept_family_invitation(uuid) to authenticated;
