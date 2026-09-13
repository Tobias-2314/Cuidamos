/**
 * GAP DE PRODUCTO (ver NOTES de PGM-26): no existe todavía una tabla/vista de
 * "perfiles" con nombre para mostrar quién es `assigned_to` — solo tenemos el
 * `user_id` (UUID de `auth.users`), que no es consultable desde el cliente.
 *
 * Esta función es un stand-in razonable y no confuso mientras esa tabla no
 * exista: "Vos" cuando el turno está asignado al usuario actual, o un
 * identificador corto y estable en caso contrario. NO inventa nombres reales
 * — cuando exista una tabla de perfiles, esta función debería reemplazarse
 * por un lookup real de nombre.
 */
export function getAssignedToLabel(assignedTo: string, currentUserId: string | null): string {
  if (currentUserId !== null && assignedTo === currentUserId) {
    return 'Vos';
  }

  const shortId = assignedTo.slice(-4).toUpperCase();
  return `Otro cuidador (…${shortId})`;
}
