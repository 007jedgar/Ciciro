import type { ColorValue } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Text as SvgText } from "react-native-svg";

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

export function ChevronRightIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline
        points="9,5 16,12 9,19"
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CloseIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth={2.1} strokeLinecap="round" />
      <Line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth={2.1} strokeLinecap="round" />
    </Svg>
  );
}

export function TrashIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline
        points="5,7 19,7"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7.5 7l.8 12.2A1.5 1.5 0 0 0 9.8 20.5h4.4a1.5 1.5 0 0 0 1.5-1.3L16.5 7"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Small circled "i" for inline help. */
export function InfoIcon({ color, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx="12" cy="7.6" r="1.15" fill={color} />
      <Line x1="12" y1="11" x2="12" y2="16.6" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

export function CheckIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline
        points="5,12 10,17 19,7"
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

/** Send: an up arrow for nested composer buttons. */
export function ArrowUpIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="12" y1="19" x2="12" y2="6.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Polyline
        points="6.5,12 12,6 17.5,12"
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

/** Manuscript tab: a pencil poised over a baseline - the writing surface, not a file. */
export function EditorIcon({ color, size = 24, focused = false }: IconProps) {
  const stroke = focused ? 2 : 1.7;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="11.5" y1="20" x2="20" y2="20" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <Path
        d="M16.3 4.1a1.85 1.85 0 0 1 2.6 2.6L8.1 17.5l-3.6 1 1-3.6z"
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Line x1="14.4" y1="6" x2="17" y2="8.6" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
    </Svg>
  );
}

/** Ask Ciciro: a twin sparkle, the app's signal for an AI action. */
export function SparkleIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M11 2.5c.55 4.9 2 6.35 6.9 6.9-4.9.55-6.35 2-6.9 6.9-.55-4.9-2-6.35-6.9-6.9 4.9-.55 6.35-2 6.9-6.9z"
        fill={color}
      />
      <Path
        d="M18.4 14.6c.28 2.15.9 2.77 3.05 3.05-2.15.28-2.77.9-3.05 3.05-.28-2.15-.9-2.77-3.05-3.05 2.15-.28 2.77-.9 3.05-3.05z"
        fill={color}
      />
    </Svg>
  );
}

/** Continue: keep the draft moving forward. */
export function ContinueIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="4" y1="8" x2="15" y2="8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="4" y1="12" x2="10.5" y2="12" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="13.5" y1="12" x2="20" y2="12" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Polyline
        points="17,9 20,12 17,15"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="4" y1="16" x2="12" y2="16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Rewrite: two arrows circling back over the text. */
export function RewriteIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M19.5 10.5A7.5 7.5 0 0 0 6.3 6.1L4 8.2"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="4,4 4,8.4 8.4,8.4"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 13.5A7.5 7.5 0 0 0 17.7 17.9L20 15.8"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="20,20 20,15.6 15.6,15.6"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Describe: a pair of quotation marks for richer prose. */
export function QuoteIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M5.5 7.5h3.6v3.7c0 2.3-1.1 3.7-3.4 4.5l-.7-1.5c1.3-.5 1.9-1.1 2-2.2H5.5z"
        fill={color}
      />
      <Path
        d="M13.9 7.5h3.6v3.7c0 2.3-1.1 3.7-3.4 4.5l-.7-1.5c1.3-.5 1.9-1.1 2-2.2h-1.5z"
        fill={color}
      />
    </Svg>
  );
}

/** New chapter: a page with a plus. */
export function NewChapterIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M7 4.5h7.2L18 8.3V19.5H7z"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Polyline
        points="14.2,4.5 14.2,8.3 18,8.3"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Line x1="12.5" y1="11.5" x2="12.5" y2="16.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="10" y1="14" x2="15" y2="14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** New folder: a folder with a plus. */
export function FolderPlusIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 7.4a1.5 1.5 0 0 1 1.5-1.5H9l2 2.1h8a1.5 1.5 0 0 1 1.5 1.5v7.6A1.5 1.5 0 0 1 19 18.6H4.5A1.5 1.5 0 0 1 3 17.1z"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Line x1="11.75" y1="11" x2="11.75" y2="15.6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="9.45" y1="13.3" x2="14.05" y2="13.3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Typography: the classic "Aa" glyph pair. */
export function TypeIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <SvgText
        x="12"
        y="17"
        fontSize="15"
        fontWeight="700"
        textAnchor="middle"
        fill={color}
      >
        Aa
      </SvgText>
    </Svg>
  );
}
export function AlertIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={1.8} />
      <Line x1="12" y1="7.2" x2="12" y2="13" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="12" cy="16.6" r="1.2" fill={color} />
    </Svg>
  );
}

/** A question mark in a circle — the editor's open forks. */
export function QuestionIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={1.8} />
      <Path
        d="M9.4 9.3a2.7 2.7 0 1 1 3.6 2.55c-.7.26-1 .8-1 1.5v.5"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx="12" cy="16.7" r="1.15" fill={color} />
    </Svg>
  );
}
