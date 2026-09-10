import type { ColorValue } from "react-native";
import Svg, { Circle, Line, Path, Polyline } from "react-native-svg";

type IconProps = {
  color: ColorValue;
  size?: number;
  focused?: boolean;
};

export function ChevronLeftIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline
        points="15,5 8,12 15,19"
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SlidersIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="4" y1="21" x2="4" y2="14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="4" y1="10" x2="4" y2="3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="12" y1="21" x2="12" y2="12" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="12" y1="8" x2="12" y2="3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="20" y1="21" x2="20" y2="16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="20" y1="12" x2="20" y2="3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="1" y1="14" x2="7" y2="14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="9" y1="8" x2="15" y2="8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="17" y1="16" x2="23" y2="16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function PlusIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function ChaptersIcon({ color, size = 24, focused = false }: IconProps) {
  const stroke = focused ? 2 : 1.7;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="6" y1="7" x2="20" y2="7" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <Line x1="6" y1="12" x2="20" y2="12" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <Line x1="6" y1="17" x2="15" y2="17" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <Circle cx="4" cy="7" r={focused ? 1.35 : 1.15} fill={color} />
      <Circle cx="4" cy="12" r={focused ? 1.35 : 1.15} fill={color} />
      <Circle cx="4" cy="17" r={focused ? 1.35 : 1.15} fill={color} />
    </Svg>
  );
}

export function ManuscriptIcon({ color, size = 24, focused = false }: IconProps) {
  const stroke = focused ? 2 : 1.7;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M7 4.5h8.2L19 8.3V19.5H7z"
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      <Polyline
        points="15.2,4.5 15.2,8.3 19,8.3"
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      <Line x1="9.5" y1="12" x2="16.5" y2="12" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <Line x1="9.5" y1="15.5" x2="14.5" y2="15.5" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
    </Svg>
  );
}

export function CiciroTabIcon({ color, size = 24, focused = false }: IconProps) {
  const r = focused ? 2.35 : 2.05;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="5.5" cy="12" r={r} fill={color} />
      <Circle cx="12" cy="12" r={r} fill={color} />
      <Circle cx="18.5" cy="12" r={r} fill={color} />
    </Svg>
  );
}