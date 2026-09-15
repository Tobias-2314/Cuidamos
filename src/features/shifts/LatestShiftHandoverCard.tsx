import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { getAssignedToLabel } from './assignedToLabel';
import { formatShiftTimeRange } from './calendarSections';
import { getLatestShiftHandoverForFamily, type LatestShiftHandover } from './shiftHandoversService';

interface LatestShiftHandoverCardProps {
  familyId: string;
  currentUserId: string | null;
}

/**
 * "Último traspaso" (F5, PGM-37) -- la contraparte de lectura de
 * `ShiftHandoverFormScreen` (PGM-36): "el último traspaso queda visible al abrir la app
 * para el siguiente cuidador". Vive dentro de `CalendarScreen` (el "hub" de turnos de la
 * familia, ver comentario ahí) en vez de una ruta nueva -- criterio de producto no
 * negociable "cero fricción": tiene que aparecer solo, sin que el usuario lo busque.
 *
 * `phase` deliberadamente NO tiene un estado 'error' separado -- a diferencia del resto
 * de las pantallas del repo (`CalendarScreen`, `MedicationHistoryScreen`), que sí
 * muestran un banner de error explícito con botón de reintentar. Acá:
 *   1. Este widget es un "nice to have" que se muestra solo, no un flujo que el usuario
 *      inició a propósito -- una falla de carga no debería verse como algo "roto" en la
 *      pantalla de inicio de la app (a diferencia de, por ejemplo, fallar al cargar el
 *      calendario, que sí bloquea una tarea real).
 *   2. BLOQUEANTE TÉCNICO conocido (ver NOTES del agente y el comentario de
 *      `getLatestShiftHandoverForFamily`): la RPC de lectura todavía no existe, así que
 *      HOY toda llamada real termina en este mismo camino ("function does not exist").
 *      Mostrar eso como un error rojo sería engañoso -- no es una falla real de la app,
 *      es una feature de Backend pendiente. El criterio de producto documentado para
 *      esta issue es explícito: "el estado 'empty' es el que se va a mostrar siempre en
 *      la práctica -- asegurate de que ese estado se vea bien y no como un error".
 * Por eso cualquier error de carga se trata igual que "sin traspaso reciente todavía"
 * (mismo texto, mismo estilo) -- se loguea un warning en dev para no perder la señal
 * durante desarrollo, pero nunca se le muestra al usuario un mensaje de error para este
 * widget puntual. `getLatestShiftHandoverForFamily` sigue devolviendo el error real
 * (service testeado por separado) -- es una decisión de PRESENTACIÓN, no del Service.
 */
type Phase = 'loading' | 'ready';

export function LatestShiftHandoverCard({ familyId, currentUserId }: LatestShiftHandoverCardProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [handover, setHandover] = useState<LatestShiftHandover | null>(null);

  const loadLatestHandover = useCallback(async () => {
    setPhase('loading');

    const result = await getLatestShiftHandoverForFamily(familyId);

    if (result.error) {
      // Ver comentario de arriba: se degrada a "sin traspaso reciente" a propósito, no
      // se propaga como error visible.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[LatestShiftHandoverCard] getLatestShiftHandoverForFamily error: ${result.error.code}`
        );
      }
      setHandover(null);
      setPhase('ready');
      return;
    }

    setHandover(result.data);
    setPhase('ready');
  }, [familyId]);

  // useFocusEffect, mismo criterio que MedicationHistoryScreen (PGM-33): al volver de
  // cerrar un turno (ShiftHandoverFormScreen hace router.back() hacia acá) esta card se
  // re-consulta sola, sin depender de que el caller pase ningún dato de vuelta.
  useFocusEffect(
    useCallback(() => {
      loadLatestHandover();
    }, [loadLatestHandover])
  );

  if (phase === 'loading') {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (!handover) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Último traspaso</Text>
        <Text style={styles.emptyText}>Todavía no hay ningún traspaso de turno registrado.</Text>
      </View>
    );
  }

  const createdByLabel = getAssignedToLabel(handover.createdBy, currentUserId);
  const shiftRangeLabel = formatShiftTimeRange({
    startsAt: handover.shiftStartsAt,
    endsAt: handover.shiftEndsAt,
  });

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Último traspaso, turno de ${shiftRangeLabel}, dejado por ${createdByLabel}`}
    >
      <Text style={styles.title}>Último traspaso</Text>
      <Text style={styles.subtitle}>
        Turno de {shiftRangeLabel} · {createdByLabel}
      </Text>

      <HandoverFieldRow label="Resumen" value={handover.resumen} />
      <HandoverFieldRow label="Comida" value={handover.comida} />
      <HandoverFieldRow label="Ánimo" value={handover.animo} />
      <HandoverFieldRow label="Pendientes" value={handover.pendientes} />
    </View>
  );
}

interface HandoverFieldRowProps {
  label: string;
  value: string | null;
}

/** Un campo del traspaso sin completar simplemente no se muestra -- los 4 son opcionales. */
function HandoverFieldRow({ label, value }: HandoverFieldRowProps) {
  if (!value) {
    return null;
  }

  return (
    <Text style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}: </Text>
      {value}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f3f8f5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dfe9e3',
    padding: 14,
    marginBottom: 16,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f4a35',
  },
  subtitle: {
    fontSize: 12,
    color: '#4c6b5c',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#5a7768',
  },
  fieldRow: {
    fontSize: 13,
    color: '#222',
    lineHeight: 18,
  },
  fieldLabel: {
    fontWeight: '600',
    color: '#1f4a35',
  },
});
