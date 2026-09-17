import { Tabs } from 'expo-router';

import { colors, fontFamily } from '../../src/theme/tokens';
import { IconCalendar, IconHome, IconPerson, IconPill } from '../../src/components/icons';

/**
 * Barra de tabs -- calco del `BottomNav` del prototipo de Figma Make
 * (`App.tsx`), que la app real nunca había portado: antes de esto no
 * existía ninguna forma de moverse entre Turnos/Medicación/Perfil salvo
 * conociendo la URL exacta. 4 tabs, iguales al Figma: Inicio (perfil de la
 * persona cuidada), Turnos, Medicación, Perfil (del cuidador).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 64,
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamily.bold,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="cared-person"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <IconHome color={color} size="md" />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Turnos',
          tabBarIcon: ({ color }) => <IconCalendar color={color} size="md" />,
        }}
      />
      <Tabs.Screen
        name="medications"
        options={{
          title: 'Medicación',
          tabBarIcon: ({ color }) => <IconPill color={color} size="md" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => <IconPerson color={color} size="md" />,
        }}
      />
    </Tabs>
  );
}
