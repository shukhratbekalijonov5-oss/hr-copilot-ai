import Svg, { Circle, Path } from "react-native-svg";

/**
 * Line icons, drawn inline.
 *
 * `currentColor` is not a thing in React Native SVG, so each icon takes an
 * explicit `color`. Shipping an icon font or a library for two dozen strokes
 * would cost more than it saves.
 */
export interface IconProps {
  size?: number;
  color?: string;
}

function Base({ size = 22, color = "#000", children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M3 10.5 12 3l9 7.5" />
    <Path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
  </Base>
);

export const BriefcaseIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
    <Path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </Base>
);

export const SparkIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M12 3v5" />
    <Path d="M12 16v5" />
    <Path d="M4.5 12h5" />
    <Path d="M14.5 12h5" />
    <Path d="m6.8 6.8 2.4 2.4" />
    <Path d="m14.8 14.8 2.4 2.4" />
    <Path d="m17.2 6.8-2.4 2.4" />
    <Path d="m9.2 14.8-2.4 2.4" />
  </Base>
);

export const MessageIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-8h2a8 8 0 0 1 8 4Z" />
  </Base>
);

export const MoreIcon = (p: IconProps) => (
  <Base {...p}>
    <Circle cx="5" cy="12" r="1" />
    <Circle cx="12" cy="12" r="1" />
    <Circle cx="19" cy="12" r="1" />
  </Base>
);

export const BellIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
    <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Base>
);

export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m20 20-3.5-3.5" />
  </Base>
);

export const BookmarkIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M6 4h12v17l-6-4-6 4V4Z" />
  </Base>
);

export const GlobeIcon = (p: IconProps) => (
  <Base {...p}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M3 12h18" />
    <Path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
  </Base>
);

export const UsersIcon = (p: IconProps) => (
  <Base {...p}>
    <Circle cx="9" cy="8" r="3.2" />
    <Path d="M3 20a6 6 0 0 1 12 0" />
    <Path d="M16 5.5a3.2 3.2 0 0 1 0 5" />
    <Path d="M18 20a6 6 0 0 0-2.5-4.9" />
  </Base>
);

export const CompareIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M9 4v16" />
    <Path d="M15 4v16" />
    <Path d="M4 8h5" />
    <Path d="M15 16h5" />
  </Base>
);

export const UserIcon = (p: IconProps) => (
  <Base {...p}>
    <Circle cx="12" cy="8" r="3.5" />
    <Path d="M5 20a7 7 0 0 1 14 0" />
  </Base>
);

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="m4.5 12.5 5 5 10-11" />
  </Base>
);

export const LockIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M6 10h12v10H6z" />
    <Path d="M9 10V7a3 3 0 0 1 6 0v3" />
  </Base>
);
