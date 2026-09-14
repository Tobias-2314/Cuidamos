import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAssignedToLabel } from './assignedToLabel';
import type { FamilyMember } from './shiftsService';

interface AssigneePickerProps {
  members: readonly FamilyMember[];
  currentUserId: string | null;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  disabled?: boolean;
}

/**
 * Picker de "asignar a" -- lista los miembros reales de la familia (PGM-27),
 * resueltos vía `listFamilyMembersForFamily`. Presentacional y puro (sin
 * fetching propio): el screen que lo usa (`ShiftFormScreen`/
 * `ShiftReassignScreen`) resuelve `members` y pasa el callback de selección.
 *
 * Reusa `getAssignedToLabel` para el label de cada opción -- mismo "Vos" /
 * "Otro cuidador (…XXXX)" que ya se usa para mostrar `assigned_to` en
 * `CalendarScreen` (ver GAP DE PRODUCTO documentado en `assignedToLabel.ts`:
 * no hay nombres reales todavía).
 */
export function AssigneePicker({
  members,
  currentUserId,
  selectedUserId,
  onSelect,
  disabled = false,
}: AssigneePickerProps) {
  if (members.length === 0) {
    return (
      <Text style={styles.emptyText}>No pudimos encontrar cuidadores para asignar el turno.</Text>
    );
  }

  return (
    <View accessibilityRole="radiogroup" style={styles.container}>
      {members.map((member) => {
        const selected = member.userId === selectedUserId;
        const label = getAssignedToLabel(member.userId, currentUserId);
        const roleLabel = member.role === 'admin' ? 'Admin' : 'Cuidador';

        return (
          <Pressable
            key={member.userId}
            onPress={() => onSelect(member.userId)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`Asignar a ${label}, ${roleLabel}`}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
              {label}
            </Text>
            <Text style={[styles.optionRole, selected && styles.optionRoleSelected]}>
              {roleLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionSelected: {
    borderColor: '#2f6f4f',
    backgroundColor: '#e6efe9',
  },
  optionLabel: {
    fontSize: 15,
    color: '#111',
    fontWeight: '500',
  },
  optionLabelSelected: {
    color: '#1f4d37',
    fontWeight: '700',
  },
  optionRole: {
    fontSize: 12,
    color: '#777',
  },
  optionRoleSelected: {
    color: '#2f6f4f',
  },
  emptyText: {
    fontSize: 14,
    color: '#777',
  },
});
