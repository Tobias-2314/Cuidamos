import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radii } from '../../theme/tokens';
import { getAssignedToLabel } from './assignedToLabel';
import type { FamilyMember } from './shiftsService';
import { Avatar } from '../../components/Avatar';
import { getCaregiverColor } from '../../lib/caregiverColor';

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
        const isCurrentUser = member.userId === currentUserId;
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
            <Avatar name={label} color={getCaregiverColor(member.userId, isCurrentUser)} size="sm" />
            <View style={styles.optionText}>
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                {label}
              </Text>
              <Text style={[styles.optionRole, selected && styles.optionRoleSelected]}>
                {roleLabel}
              </Text>
            </View>
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
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    color: colors.ink,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
  },
  optionLabelSelected: {
    color: colors.brandDark,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
  },
  optionRole: {
    fontSize: 12,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
  },
  optionRoleSelected: {
    color: colors.brand,
  },
  emptyText: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
  },
});
