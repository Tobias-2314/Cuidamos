import Svg, { Circle, Path, Rect, type SvgProps } from 'react-native-svg';

import { colors } from '../theme/tokens';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

/** `w-4/w-5/w-6/w-8` de Tailwind -- tamaños de ícono usados en el Figma. */
const ICON_SIZE_PX: Record<IconSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

export interface IconProps {
  size?: IconSize;
  color?: string;
}

interface IconWrapProps extends IconProps {
  children: SvgProps['children'];
}

/** Calco del `SvgWrap` del prototipo de Figma Make -- viewBox 24x24, stroke de 1.85. */
function IconWrap({ size = 'md', color = colors.ink, children }: IconWrapProps) {
  const px = ICON_SIZE_PX[size];
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.85}>
      {children}
    </Svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M9 21V12h6v9" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconPill(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M10.5 20.5 3.5 13.5a5 5 0 017.07-7.07l7 7a5 5 0 01-7.07 7.07z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M8.5 11.5l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconPerson(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Circle cx="12" cy="8" r="4" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconX(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.89 12 19.79 19.79 0 01.92 4.18 2 2 0 012.91 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconWrap>
  );
}

export function IconMail(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Rect x="2" y="4" width="20" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2 7l10 7 10-7" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconClock(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconShare(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconWrap>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconWrap>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 9v4M12 17h.01" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconWrap>
  );
}

export function IconLink(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconWrap>
  );
}

export function IconPin(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="10" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconWrap>
  );
}

export function IconClip(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Path
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x="9" y="3" width="6" height="4" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 12h6M9 16h4" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <IconWrap {...props}>
      <Circle cx="12" cy="12" r="10" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" />
    </IconWrap>
  );
}
