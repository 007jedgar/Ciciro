import { Circle, HStack, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  padding,
  strokeBorder,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type WritingDayWidgetProps = {
  words: number;
  goal: number;
  daysInLast7: number;
  openUrl: string;
};

// The landing page's seal mark (src/components/BrandMark.tsx), drawn natively so it stays
// crisp and themeable: a thin ink ring around three vermilion dots.
const SealMark = ({ ink, vermilion, size = 14 }: { ink: string; vermilion: string; size?: number }) => {
  "widget";
  const dot = size * 0.22;
  return (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <Circle
        modifiers={[
          frame({ width: size, height: size }),
          strokeBorder({ content: ink, style: { lineWidth: Math.max(1, size * 0.08) } }),
        ]}
      />
      <HStack spacing={dot * 0.55} modifiers={[frame({ width: size, height: size })]}>
        <Circle modifiers={[frame({ width: dot, height: dot }), foregroundStyle(vermilion)]} />
        <Circle modifiers={[frame({ width: dot, height: dot }), foregroundStyle(vermilion)]} />
        <Circle modifiers={[frame({ width: dot, height: dot }), foregroundStyle(vermilion)]} />
      </HStack>
    </ZStack>
  );
};

const WritingDayWidgetView = (props: WritingDayWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const words = Math.max(0, Math.floor(props.words));
  const goal = Math.max(0, Math.floor(props.goal));
  const days = Math.max(0, Math.floor(props.daysInLast7));
  const url = props.openUrl || "ciciro:///manuscripts";
  const family = environment.widgetFamily;
  const ink = environment.colorScheme === "dark" ? "#F4EDE3" : "#2C241B";
  const soft = environment.colorScheme === "dark" ? "#C9B8A4" : "#6B5B4D";
  const vermilion = environment.colorScheme === "dark" ? "#FF5A40" : "#E8442C";

  if (family === "accessoryInline") {
    return (
      <Text modifiers={[widgetURL(url), foregroundStyle(ink)]}>
        {`${words}/${goal} · ${days}/7`}
      </Text>
    );
  }

  if (family === "accessoryCircular") {
    return (
      <VStack modifiers={[widgetURL(url), padding({ all: 4 })]}>
        <Text modifiers={[font({ size: 16, weight: "bold" }), foregroundStyle(ink)]}>
          {String(words)}
        </Text>
        <Text modifiers={[font({ size: 10 }), foregroundStyle(soft)]}>{`/ ${goal}`}</Text>
      </VStack>
    );
  }

  if (family === "accessoryRectangular") {
    return (
      <VStack modifiers={[widgetURL(url), padding({ all: 6 })]}>
        <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(ink)]}>
          {`${words} of ${goal}`}
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(soft)]}>
          {`${days} of the last 7`}
        </Text>
      </VStack>
    );
  }

  return (
    <ZStack>
      <VStack modifiers={[widgetURL(url), padding({ all: 12 })]}>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(soft)]}>Today</Text>
        <Text modifiers={[font({ size: 22, weight: "bold" }), foregroundStyle(ink)]}>
          {`${words} / ${goal}`}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(soft)]}>
          {`${days} of the last 7 days`}
        </Text>
      </VStack>
      <VStack
        modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topTrailing" }),
          padding({ top: 10, trailing: 10 }),
        ]}
      >
        <SealMark ink={ink} vermilion={vermilion} />
      </VStack>
    </ZStack>
  );
};

export default createWidget("WritingDayWidget", WritingDayWidgetView);
