import { act, render, screen } from "@testing-library/react-native";
import { RefreshControl, View } from "react-native";
import ManuscriptsScreen from "../app/manuscripts";
import { fadeUpDelay } from "../lib/skeleton";
import "../lib/i18n";

// Entrance builders that remember what they were asked for, so each row's
// `entering` can be read back off the rendered view as e.g. "fade:120".
// `lastItemLayoutAnimation` captures the FlatList-level `itemLayoutAnimation`
// the same way, since that prop has no per-row DOM node to read it off of.
let lastItemLayoutAnimation = "unset";
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
  const AnimatedFlatList = React.forwardRef(
    ({ itemLayoutAnimation, ...rest }: Record<string, unknown>, ref: unknown) => {
      lastItemLayoutAnimation = (itemLayoutAnimation as { tag?: string } | undefined)?.tag ?? "none";
      return React.createElement(RN.FlatList, { ...rest, ref });
    }
  );
  return {
    ...base,
    __esModule: true,
    FadeInDown: tagged("fade"),
    SlideInRight: tagged("slide"),
    LinearTransition: tagged("layout"),
    default: { ...base.default, View: AnimatedView, FlatList: AnimatedFlatList },
  };
});

type Project = { id: string; title: string; folderId: string | null; kind: string; _count: { chapters: number } };

let mockSession = { user: { id: "u1" } as { id: string } | null, ready: true };
let mockProjects: { data: Project[] | undefined; isPending: boolean; isRefetching?: boolean; refetch?: () => Promise<unknown> } = {
  data: undefined,
  isPending: true,
};
let mockFolders: { data: unknown[] | undefined; isPending: boolean } = { data: [], isPending: false };
let mockReduceMotion = false;

// Whether the navigator has this screen focused, so a test can blur it
// (another screen pushed on top, this one detached underneath), focus it
// again (popped back to), or mount it already covered.
let mockFocused = true;
const mockFocusListeners = new Set<() => void>();
jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    Redirect: () => null,
    useIsFocused: () =>
      React.useSyncExternalStore(
        (listener: () => void) => {
          mockFocusListeners.add(listener);
          return () => mockFocusListeners.delete(listener);
        },
        () => mockFocused
      ),
  };
});

function setFocused(focused: boolean) {
  act(() => {
    mockFocused = focused;
    for (const listener of mockFocusListeners) listener();
  });
}

function blur() {
  setFocused(false);
}

function focus() {
  setFocused(true);
}
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
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0, useMeasuredAppHeaderHeight: () => [0, () => {}] }));
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
  mockFocused = true;
  lastItemLayoutAnimation = "unset";
});

describe("Manuscripts pull to refresh", () => {
  const refreshing = () => screen.UNSAFE_getByType(RefreshControl).props.refreshing;

  it("shows the spinner for a pull, not for a background refetch that would shift rows mid-push", async () => {
    mockProjects = { data: THREE, isPending: false, isRefetching: true };
    const view = render(<ManuscriptsScreen />);
    expect(refreshing()).toBe(false);

    // React Query's refetch resolves to the query's result, never undefined.
    const pending: (() => void)[] = [];
    const refetch = () =>
      new Promise<{ isError: boolean }>((resolve) => pending.push(() => resolve({ isError: false })));
    mockProjects = { data: THREE, isPending: false, refetch };
    mockFolders = { data: [], isPending: false, refetch } as typeof mockFolders;
    view.rerender(<ManuscriptsScreen />);
    act(() => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(refreshing()).toBe(true);

    await act(async () => pending.forEach((resolve) => resolve()));
    expect(refreshing()).toBe(false);
  });
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

  it("turns the list's layout transition off once settled, so a return trip from another screen can't replay it from a stale layout", () => {
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);
    // First reveal: the layout transition is still on, smoothing the stagger's reflow.
    expect(lastItemLayoutAnimation).toBe("layout:0");

    // A plain re-render with unchanged rows - no unmount, no data change -
    // must not leave the layout transition running.
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");

    // Off to the chapters and back: off while detached, and off on the
    // render that reattaches the screen.
    blur();
    expect(lastItemLayoutAnimation).toBe("none");
    focus();
    expect(lastItemLayoutAnimation).toBe("none");

    // Another plain re-render after the return trip - still settled.
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
  });

  it("turns the layout transition back on while a fresh row slides in, even after the list has settled", () => {
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");

    mockProjects = { data: [project("d", "Delta"), ...THREE], isPending: false };
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("layout:0");
    expect(screen.getByText("Delta")).toBeTruthy();

    // Once the fresh row is no longer fresh, the list is settled again.
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
  });

  it("keeps the layout transition off, and slides nothing in, for a manuscript created while the screen was behind its chapters", () => {
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);
    view.rerender(<ManuscriptsScreen />);

    // Creating (or importing) a manuscript opens its chapters straight away,
    // and the refetched list lands while this screen is detached underneath.
    blur();
    mockProjects = { data: [project("d", "Delta"), ...THREE], isPending: false };
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
    expect(enteringOf("Delta")).toBe("none");

    // Back on the list: the return render must not turn the transition on.
    focus();
    expect(lastItemLayoutAnimation).toBe("none");
    expect(enteringOf("Delta")).toBe("none");
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
  });

  it("still animates the reflow when a row is removed or the rows reorder while the screen is focused", () => {
    mockProjects = { data: THREE, isPending: false };
    const view = render(<ManuscriptsScreen />);
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");

    // A manuscript deleted or moved into a folder: the rest close up.
    mockProjects = { data: [project("a", "Alpha"), project("c", "Charlie")], isPending: false };
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("layout:0");
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");

    // The same rows in a new order.
    mockProjects = { data: [project("c", "Charlie"), project("a", "Alpha")], isPending: false };
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("layout:0");
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
  });

  it("starts no entrance or layout motion, then or on return, for a list that first loaded while the screen was already covered", () => {
    // A cold launch that restores the last place mounts the list under the
    // chapters it pushes, never focused, and the data lands there.
    mockFocused = false;
    mockProjects = { data: undefined, isPending: true };
    const view = render(<ManuscriptsScreen />);
    mockProjects = { data: THREE, isPending: false };
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
    expect(enteringOf("Alpha")).toBe("none");
    expect(enteringOf("Charlie")).toBe("none");

    // Back from the chapters: the reattaching render must not turn anything on.
    focus();
    expect(lastItemLayoutAnimation).toBe("none");
    expect(enteringOf("Alpha")).toBe("none");
    expect(enteringOf("Charlie")).toBe("none");
    view.rerender(<ManuscriptsScreen />);
    expect(lastItemLayoutAnimation).toBe("none");
    expect(enteringOf("Alpha")).toBe("none");
  });
});
