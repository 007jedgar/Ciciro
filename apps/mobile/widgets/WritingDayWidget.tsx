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
  // The landing page's seal mark (src/components/BrandMark.tsx): a thin ink ring around
  // three vermilion dots. Inlined (not a separate component) since the widget runtime only
  // captures the single tagged function passed to createWidget.
  const sealSize = 18;
  const sealDot = (sealSize * 7.2) / 48;
  const sealGap = (sealSize * (9.5 - 7.2)) / 48;
  const sealStroke = Math.max(1, (sealSize * 2) / 48);
  const sealMark = (
    <ZStack modifiers={[frame({ width: sealSize, height: sealSize })]}>
      <Circle
        modifiers={[
          frame({ width: sealSize, height: sealSize }),
          // strokeBorder overlays a stroked shape (a rectangle unless told otherwise) and leaves
          // the Circle's own fill in place, so clear the fill and stroke a circle.
          foregroundStyle("#00000000"),
          strokeBorder({ content: ink, style: { lineWidth: sealStroke }, shape: "circle" }),
        ]}
      />
      <HStack spacing={sealGap} modifiers={[frame({ width: sealSize, height: sealSize })]}>
        <Circle modifiers={[frame({ width: sealDot, height: sealDot }), foregroundStyle(vermilion)]} />
        <Circle modifiers={[frame({ width: sealDot, height: sealDot }), foregroundStyle(vermilion)]} />
        <Circle modifiers={[frame({ width: sealDot, height: sealDot }), foregroundStyle(vermilion)]} />
      </HStack>
    </ZStack>
  );

  // A goal is optional: with none (0) the widget shows today's words on their own.
  const hasGoal = goal > 0;

  if (family === "accessoryInline") {
    return (
      <Text modifiers={[widgetURL(url), foregroundStyle(ink)]}>
        {hasGoal ? `${words}/${goal} · ${days}/7` : `${words} · ${days}/7`}
      </Text>
    );
  }

  if (family === "accessoryCircular") {
    return (
      <VStack modifiers={[widgetURL(url), padding({ all: 4 })]}>
        <Text modifiers={[font({ size: 16, weight: "bold" }), foregroundStyle(ink)]}>
          {String(words)}
        </Text>
        <Text modifiers={[font({ size: 10 }), foregroundStyle(soft)]}>{hasGoal ? `/ ${goal}` : "words"}</Text>
      </VStack>
    );
  }

  if (family === "accessoryRectangular") {
    return (
      <VStack modifiers={[widgetURL(url), padding({ all: 6 })]}>
        <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(ink)]}>
          {hasGoal ? `${words} of ${goal}` : `${words} words`}
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
          {hasGoal ? `${words} / ${goal}` : `${words} words`}
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
        {sealMark}
      </VStack>
    </ZStack>
  );
};

export default createWidget("WritingDayWidget", WritingDayWidgetView);
