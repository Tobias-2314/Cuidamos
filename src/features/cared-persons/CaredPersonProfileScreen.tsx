import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { resolveCaredPersonContext } from './caredPersonContext';
import {
  getEmergencyContactsForCaredPerson,
  getMedicalContactsForCaredPerson,
  type EmergencyContact,
  type MedicalContact,
} from './contactsService';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AppHeader } from '../../components/AppHeader';
import { SectionHeader } from '../../components/SectionHeader';
import { ContactRow } from '../../components/ContactRow';
import { IconButton } from '../../components/IconButton';
import { IconEdit, IconHeart, IconPlus } from '../../components/icons';

/**
 * `phase` sigue el mismo criterio de estados explícitos que el resto de las
 * pantallas del repo:
 * - 'loading': resolviendo familia + cared_person + sus contactos.
 * - 'no-family': mismo gap de producto que el resto de las pantallas.
 * - 'no-cared-person': la familia todavía no cargó el perfil de la persona
 *   cuidada -- a diferencia de otras pantallas con este mismo estado (ej.
 *   `MedicationFormScreen`), acá se REDIRIGE automáticamente a
 *   `/cared-person/new` en vez de mostrar un botón, tal como lo pide PGM-23
 *   ("dada la cared_person de la familia -- o el estado vacío si no hay
 *   ninguna todavía -- redirigir a /cared-person/new"). Se renderiza un
 *   estado de carga como fallback mientras el redirect ocurre.
 * - 'error': falló la carga de familia/cared_persons/contactos.
 * - 'ready': la ficha está visible.
 */
type Phase = 'loading' | 'no-family' | 'no-cared-person' | 'error' | 'ready';

export function CaredPersonProfileScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [caredPersonFullName, setCaredPersonFullName] = useState<string | null>(null);
  const [medicalContacts, setMedicalContacts] = useState<MedicalContact[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setErrorMessage(null);

    const context = await resolveCaredPersonContext();

    if (context.status === 'error') {
      setErrorMessage(context.message);
      setPhase('error');
      return;
    }

    if (context.status === 'no-family') {
      setPhase('no-family');
      return;
    }

    if (context.status === 'no-cared-person') {
      // Ver criterio de redirect automático en el comentario de `Phase` arriba.
      setPhase('no-cared-person');
      router.replace('/cared-person/new');
      return;
    }

    const [medicalResult, emergencyResult] = await Promise.all([
      getMedicalContactsForCaredPerson(context.caredPersonId),
      getEmergencyContactsForCaredPerson(context.caredPersonId),
    ]);

    if (medicalResult.error) {
      setErrorMessage(medicalResult.error.message);
      setPhase('error');
      return;
    }

    if (emergencyResult.error) {
      setErrorMessage(emergencyResult.error.message);
      setPhase('error');
      return;
    }

    setCaredPersonFullName(context.caredPersonFullName);
    setMedicalContacts(medicalResult.data);
    setEmergencyContacts(emergencyResult.data);
    setPhase('ready');
  }, [router]);

  // `useFocusEffect` (no un `useEffect` con `[]`) a propósito -- mismo criterio que
  // `MedicationsScreen`: al volver acá con `router.back()` desde los formularios de alta de
  // médico/contacto de emergencia, esta pantalla necesita recargar las listas sin depender de
  // que el caller le pase ningún dato de vuelta.
  useFocusEffect(
    useCallback(() => {
      loadInitialData();
    }, [loadInitialData])
  );

  if (phase === 'loading' || phase === 'no-cared-person') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator />
        <Text style={styles.helperText}>Cargando…</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {errorMessage}
        </Text>
        <Button label="Reintentar" onPress={loadInitialData} />
      </View>
    );
  }

  if (phase === 'no-family') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
        <Text style={styles.helperText}>
          Creá una familia para empezar a cargar la ficha de la persona cuidada.
        </Text>
        <Button label="Crear familia" onPress={() => router.push('/family/create')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader
        title="Inicio"
        right={
          <IconButton
            icon={<IconEdit size="sm" color={colors.brand} />}
            onPress={() => router.push('/cared-person/new')}
            accessibilityLabel="Editar persona cuidada"
          />
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View style={styles.profileIconBadge}>
              <IconHeart size="lg" color={colors.brand} />
            </View>
            <Text style={styles.profileName}>{caredPersonFullName}</Text>
          </View>
        </Card>

        <SectionHeader
          title="Contactos médicos"
          action={
            <Button
              label="Agregar"
              onPress={() => router.push('/cared-person/medical-contacts/new')}
              accessibilityLabel="Agregar médico"
              variant="ghost"
              size="sm"
              icon={<IconPlus size="sm" color={colors.brand} />}
            />
          }
        />
        {medicalContacts.length > 0 ? (
          <Card style={styles.listCard}>
            {medicalContacts.map((contact, index) => (
              <View key={contact.id}>
                {index > 0 ? <View style={styles.rowDivider} /> : null}
                <ContactRow
                  name={contact.fullName}
                  sub={contact.specialty ?? 'Sin especialidad'}
                  phone={contact.phone}
                />
              </View>
            ))}
          </Card>
        ) : (
          <Text style={styles.emptySectionText}>Todavía no hay médicos cargados.</Text>
        )}

        <SectionHeader
          title="Contactos de emergencia"
          action={
            <Button
              label="Agregar"
              onPress={() => router.push('/cared-person/emergency-contacts/new')}
              accessibilityLabel="Agregar contacto de emergencia"
              variant="ghost"
              size="sm"
              icon={<IconPlus size="sm" color={colors.brand} />}
            />
          }
        />
        {emergencyContacts.length > 0 ? (
          <Card style={styles.listCard}>
            {emergencyContacts.map((contact, index) => (
              <View key={contact.id}>
                {index > 0 ? <View style={styles.rowDivider} /> : null}
                <ContactRow
                  name={contact.fullName}
                  sub={contact.relationship ?? 'Sin relación'}
                  phone={contact.phone}
                />
              </View>
            ))}
          </Card>
        ) : (
          <Text style={styles.emptySectionText}>Todavía no hay contactos de emergencia cargados.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingBottom: 32,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
  },
  helperText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: colors.error,
    fontFamily: fontFamily.medium,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  profileCard: {
    marginHorizontal: 20,
    marginTop: 20,
    padding: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    flex: 1,
    fontSize: 20,
    fontFamily: fontFamily.extraBold,
    fontWeight: '800',
    color: colors.ink,
  },
  listCard: {
    marginHorizontal: 20,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  emptySectionText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    paddingHorizontal: 20,
  },
});
