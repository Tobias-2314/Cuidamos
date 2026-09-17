/**
 * Design tokens portados del prototipo de Figma Make (paleta verde-teal +
 * Nunito). Única fuente de colores/radios/tipografía -- las pantallas NO
 * hardcodean hex ni `fontFamily` sueltos, importan de acá.
 */

export const colors = {
  brand: '#0C8C7D',
  brandDark: '#09695D',
  brandMid: '#75C0B8',
  brandLight: '#E6F4F2',
  brandXLight: '#F0F9F8',

  surface: '#FFFFFF',
  surface2: '#F2F8F7',
  border: '#CAE3DF',
  border2: '#E4F0EE',

  ink: '#182B29',
  ink2: '#446A67',
  ink3: '#85ACAA',

  error: '#BF5240',
  errorBg: '#FDEEED',
  errorMid: '#E8988C',

  warn: '#C87B35',
  warnBg: '#FEF2E7',

  ok: '#2E9E85',
  okBg: '#E8F5F2',

  white: '#FFFFFF',
} as const;

/**
 * `sm`/`md`/`lg`/`xl` calcan el `@theme` custom del prototipo de Figma Make
 * (`--radius-sm/md/lg/xl`). `card`/`badge` cubren los dos radios que el
 * prototipo también usa (`rounded-2xl`/`rounded-3xl`) pero que Tailwind
 * resuelve con sus valores default porque el `@theme` nunca los redefinió
 * -- no seguían la escala sm→xl, así que los sumamos aparte en vez de
 * forzarlos a encajar ahí.
 */
export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  /** `rounded-2xl` (default de Tailwind, 16px) -- usado por `Card`. */
  card: 16,
  /** `rounded-3xl` (default de Tailwind, 24px) -- logo del login, badges grandes. */
  badge: 24,
} as const;

/**
 * Distingue cuidadores en avatares/turnos cuando hay más de uno en la
 * familia -- `colors.brand` queda reservado para "Vos" (convención ya
 * establecida en toda la app), estos 5 tonos cálidos y apagados son para
 * el resto, asignados de forma determinística por user id (ver
 * `getCaregiverColor` en `src/lib/caregiverColor.ts`). Sin esto, cualquier
 * pantalla con varios cuidadores (Calendario, Cobertura) los mostraba a
 * todos con el mismo color -- una sola nota de paleta, imposible de
 * escanear de un vistazo quién es quién.
 */
export const caregiverPalette = [
  '#C87355', // terracota
  '#5C87A8', // celeste apagado
  '#A0698C', // ciruela
  '#8FA05C', // salvia
  '#C89B35', // ámbar
] as const;

/**
 * Sombras suaves -- las `Card` del port inicial de Figma quedaban chatas
 * (solo borde de 1px). `sm` para elementos chicos (badges, avatares
 * flotantes), `md` para tarjetas de contenido.
 */
export const shadow = {
  sm: {
    shadowColor: '#182B29',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: '#182B29',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Familias de Nunito registradas por `useAppFonts` (`src/theme/useAppFonts.ts`)
 * vía `@expo-google-fonts/nunito`. Usar estas constantes en vez de escribir el
 * nombre de la familia a mano.
 */
export const fontFamily = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_500Medium',
  semiBold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extraBold: 'Nunito_800ExtraBold',
} as const;
