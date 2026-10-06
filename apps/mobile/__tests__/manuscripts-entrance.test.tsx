import { render, screen } from "@testing-library/react-native";
import { View } from "react-native";
import ManuscriptsScreen from "../app/manuscripts";
import { fadeUpDelay } from "../lib/skeleton";
import "../lib/i18n";

// Entrance builders that remember what they were asked for, so each row's
// `entering` can be read back off the rendered view as e.g. "fade:120".
jest.mock("react-native-reanimated", () => {
  const base = jest.requireActual("../__mocks__/react-native-reanimated");
  const React = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  function tagged(kind: string, delay = 0): Record<string, unknown> {
    return {
      tag: `${kind}:${delay}`,
      duration: () => tagged(kind, delay),
      delay: (ms: number) => tagged(kind, ms),
    };
  }
  const AnimatedView = React.forwardRef(
    ({ entering, exiting, layout, ...rest }: Record<string, unknown>, ref: unknown) =>
      React.createElement(RN.View, {
        ...rest,
        ref,
        entering: (entering as { tag?: string } | undefined)?.tag ?? "none",
      })
  );
  return {
    ...base,
    __esModule: true,
    FadeInDown: tagged("fade"),
    SlideInRight: tagged("slide"),
    default: { ...base.default, View: AnimatedView },
  };
});

type Project = { id: string; title: string; folderId: string | null; kind: string; _count: { chapters: number } };

let mockSession = { user: { id: "u1" } as { id: string } | null, ready: true };
let mockProjects: { data: Project[] | undefined; isPending: boolean } = { data: undefined, isPending: true };
let mockFolders: { data: unknown[] | undefined; isPending: boolean } = { data: [], isPending: false };
let mockReduceMotion = false;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  Redirect: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../lib/session", () => ({ useSession: () => mockSession }));
jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  useProjectsQuery: () => ({ ...mockProjects, error: null }),
  useFoldersQuery: () => ({ ...mockFolders, error: null }),
}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: mockReduceMotion } };
  },
  useOptionalAppTheme: () => ({ settings: { reduceMotion: mockReduceMotion } }),
}));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0 }));
jest.mock("../components/HeaderNewMenu", () => ({ HeaderNewMenu: () => null }));
jest.mock("../lib/import", () => ({
  importManuscriptFile: jest.fn(),
  isImportable: () => true,
  pickImportFile: jest.fn(),
}));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: jest.fn() }) }));

function project(id: string, title: string): Project {
  return { id, title, folderId: null, kind: "novel", _count: { chapters: 1 } };
}

/** The entrance tag on the animated view wrapping the card titled `title`. */
function enteringOf(title: string): string {
  let node = screen.getByText(title).parent;
  while (node) {
    if (node.type === View && typeof node.props.entering === "string") return node.props.entering;
    node = node.parent;
  }
  throw new Error(`no animated row around ${title}`);
}

const THREE = [project("a", "Alpha"), project("b", "Bravo"), project("c", "Charlie")];

beforeEach(() => {
  mockSession = { user: { id: "u1" }, ready: true };
  mockFolders = { data: [], isPending: false };
  mockReduceMotion = false;
});

describe("Manuscripts list entrance", () => {
  it("staggers the first screenful in once the list loads", () => {
    mockProjects = { data: undefined, isPending: true };
    const view = render(<ManuscriptsScreen />);
    expect(screen.queryByText("Alpha")).toBeNull();

    mockProjects = { data: THREE, isPending: false };
    view.rerender(<ManuscriptsScreen />);

    expect(enteringOf("Alpha")).toBe(`fade:${fadeUpDelay(0)}`);
    expect(enteringOf("Bravo")).toBe(`fade:${fadeUpDelay(1)}`);
    expect(enteringOf("Charlie")).toBe(`fade:${fadeUpDelay(2)}`);
  });

  it("still staggers on a warm launch where cached rows exist before the session is ready", () => {
    mockSession = { user: null, ready: false };
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);
    expect(screen.queryByText("Alpha")).toBeNull();

    mockSession = { user: { id: "u1" }, ready: true };
    view.rerender(<ManuscriptsScreen />);

    expect(enteringOf("Alpha")).toBe(`fade:${fadeUpDelay(0)}`);
    expect(enteringOf("Charlie")).toBe(`fade:${fadeUpDelay(2)}`);
  });

  it("slides in only a manuscript created after the list was shown; rows mounted later just appear", () => {
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);

    mockProjects = { data: [project("d", "Delta"), ...THREE], isPending: false };
    view.rerender(<ManuscriptsScreen />);

    expect(enteringOf("Delta")).toBe("slide:0");
    // Existing rows are past their reveal: a later mount must not replay the delayed fade.
    expect(enteringOf("Alpha")).toBe("none");
    expect(enteringOf("Charlie")).toBe("none");

    // Once seen, the new row is no longer fresh.
    view.rerender(<ManuscriptsScreen />);
    expect(enteringOf("Delta")).toBe("none");
  });

  it("animates nothing with reduce motion on", () => {
    mockReduceMotion = true;
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);
    expect(enteringOf("Alpha")).toBe("none");
    expect(enteringOf("Bravo")).toBe("none");

    mockProjects = { data: [project("d", "Delta"), ...THREE], isPending: false };
    view.rerender(<ManuscriptsScreen />);
    expect(enteringOf("Delta")).toBe("none");
  });
});
