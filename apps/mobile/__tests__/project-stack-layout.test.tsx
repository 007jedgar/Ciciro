import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import ProjectStackLayout from "../app/project/[id]/_layout";
import { CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS } from "../lib/stack-pop";

const mockScreens = new Map<string, { options?: { presentation?: string } }>();

jest.mock("expo-router", () => {
  const Stack = ({ children }: { children: ReactNode }) => children;
  Stack.Screen = (props: { name: string; options?: { presentation?: string } }) => {
    mockScreens.set(props.name, props);
    return null;
  };
  return { Stack, useLocalSearchParams: () => ({}) };
});

jest.mock("../components/StackPopTransition", () => ({ StackPopTransition: () => null }));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));

/** Top-level routes in the project folder, named the way expo-router names them. */
function projectRoutes(): string[] {
  const dir = join(__dirname, "../app/project/[id]");
  return readdirSync(dir)
    .filter((entry) => entry !== "_layout.tsx" && entry !== "(tabs)")
    .map((entry) => {
      const path = join(dir, entry);
      if (!statSync(path).isDirectory()) return entry.replace(/\.tsx$/, "");
      const files = readdirSync(path);
      if (files.includes("_layout.tsx") || files.includes("index.tsx")) return entry;
      return `${entry}/${files[0].replace(/\.tsx$/, "")}`;
    });
}

// Every route that leaves by the pop transition must be presented over the
// stack, or going back plays the collapse against a blank screen.
describe("project stack layout", () => {
  beforeAll(() => {
    mockScreens.clear();
    render(<ProjectStackLayout />);
  });

  it.each(projectRoutes())("presents %s over the stack", (route) => {
    expect(mockScreens.get(route)?.options?.presentation).toBe(CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS.presentation);
  });
});
