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
