/**
 * GAP DE PRODUCTO compartido con `shifts.assignedToLabel` (ver ese archivo): no existe
 * todavía una tabla/vista de "perfiles" con nombre real para mostrar quién es
 * `taken_by` -- solo tenemos el `user_id` (UUID de `auth.users`), no consultable desde
 * el cliente.
 *
 * Se replica acá el mismo patrón ("Vos" / identificador corto) en vez de importar
 * `getAssignedToLabel` desde `src/features/shifts/` a propósito: son dos features
 * distintas (turnos vs. medicación) sin ninguna otra dependencia cruzada entre sí, y
 * esta función es lo bastante chica (unas pocas líneas) que una dependencia cruzada de
 * un feature a otro solo por reusarla no vale la pena -- agregaría acoplamiento entre
 * módulos por una duplicación mínima. Si esta lógica creciera (ej. lookup real de
 * nombre contra una tabla de perfiles), en ESE momento sí conviene extraerla a un
 * helper compartido fuera de `features/`.
 */
export function getMedicationTakenByLabel(takenBy: string, currentUserId: string | null): string {
  if (currentUserId !== null && takenBy === currentUserId) {
    return 'Vos';
  }

  const shortId = takenBy.slice(-4).toUpperCase();
  return `Otro cuidador (…${shortId})`;
}
