import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { resolveCaredPersonContext } from './caredPersonContext';
import {
  getEmergencyContactsForCaredPerson,
  getMedicalContactsForCaredPerson,
  type EmergencyContact,
  type MedicalContact,
} from './contactsService';

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
        <Pressable
          style={styles.retryButton}
          onPress={loadInitialData}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
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
        <Pressable
          style={styles.retryButton}
          onPress={() => router.push('/family/create')}
          accessibilityRole="button"
          accessibilityLabel="Crear familia"
        >
          <Text style={styles.retryButtonText}>Crear familia</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{caredPersonFullName}</Text>

      <ContactSection
        heading="Médicos"
        emptyLabel="Todavía no hay médicos cargados."
        addLabel="+ Agregar médico"
        addAccessibilityLabel="Agregar médico"
        onAddPress={() => router.push('/cared-person/medical-contacts/new')}
      >
        {medicalContacts.map((contact) => (
          <MedicalContactRow key={contact.id} contact={contact} />
        ))}
      </ContactSection>

      <ContactSection
        heading="Contactos de emergencia"
        emptyLabel="Todavía no hay contactos de emergencia cargados."
        addLabel="+ Agregar contacto"
        addAccessibilityLabel="Agregar contacto de emergencia"
        onAddPress={() => router.push('/cared-person/emergency-contacts/new')}
      >
        {emergencyContacts.map((contact) => (
          <EmergencyContactRow key={contact.id} contact={contact} />
        ))}
      </ContactSection>
    </ScrollView>
  );
}

interface ContactSectionProps {
  heading: string;
  emptyLabel: string;
  addLabel: string;
  addAccessibilityLabel: string;
  onAddPress: () => void;
  children: ReactNode;
}

function ContactSection({
  heading,
  emptyLabel,
  addLabel,
  addAccessibilityLabel,
  onAddPress,
  children,
}: ContactSectionProps) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading}>{heading}</Text>
        <Pressable
          style={styles.addButton}
          onPress={onAddPress}
          accessibilityRole="button"
          accessibilityLabel={addAccessibilityLabel}
        >
          <Text style={styles.addButtonText}>{addLabel}</Text>
        </Pressable>
      </View>

      {hasChildren ? children : <Text style={styles.helperText}>{emptyLabel}</Text>}
    </View>
  );
}

function callPhoneNumber(phone: string) {
  Linking.openURL(`tel:${phone}`);
}

interface MedicalContactRowProps {
  contact: MedicalContact;
}

function MedicalContactRow({ contact }: MedicalContactRowProps) {
  return (
    <View style={styles.contactRow}>
      <Text style={styles.contactName}>{contact.fullName}</Text>
      {contact.specialty ? <Text style={styles.contactSubtitle}>{contact.specialty}</Text> : null}
      {contact.phone ? (
        <Pressable
          onPress={() => callPhoneNumber(contact.phone as string)}
          accessibilityRole="link"
          accessibilityLabel={`Llamar a ${contact.fullName} al ${contact.phone}`}
        >
          <Text style={styles.contactPhone}>{contact.phone}</Text>
        </Pressable>
      ) : null}
      {contact.notes ? <Text style={styles.contactNotes}>{contact.notes}</Text> : null}
    </View>
  );
}

interface EmergencyContactRowProps {
  contact: EmergencyContact;
}

function EmergencyContactRow({ contact }: EmergencyContactRowProps) {
  return (
    <View style={styles.contactRow}>
      <Text style={styles.contactName}>{contact.fullName}</Text>
      {contact.relationship ? (
        <Text style={styles.contactSubtitle}>{contact.relationship}</Text>
      ) : null}
      <Pressable
        onPress={() => callPhoneNumber(contact.phone)}
        accessibilityRole="link"
        accessibilityLabel={`Llamar a ${contact.fullName} al ${contact.phone}`}
      >
        <Text style={styles.contactPhone}>{contact.phone}</Text>
      </Pressable>
      {contact.notes ? <Text style={styles.contactNotes}>{contact.notes}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 24,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  helperText: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#b3261e',
    fontWeight: '500',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  section: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
  },
  addButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f6f4f',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: '#2f6f4f',
    fontWeight: '600',
    fontSize: 13,
  },
  contactRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 2,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  contactSubtitle: {
    fontSize: 13,
    color: '#666',
  },
  contactPhone: {
    fontSize: 15,
    color: '#2f6f4f',
    fontWeight: '600',
    marginTop: 2,
  },
  contactNotes: {
    fontSize: 13,
    color: '#777',
    fontStyle: 'italic',
    marginTop: 2,
  },
});
