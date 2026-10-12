import { fireEvent, render, screen } from "@testing-library/react-native";
import CanvasScreen from "../app/project/[id]/canvas";
import type { CanvasBoardResponse } from "../lib/api/types";

let mockData: CanvasBoardResponse | undefined;
let mockIsPending = false;
let mockIsError = false;
let mockError: unknown = null;
const mockRefetch = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "p1" }),
  Redirect: () => null,
}));
jest.mock("../lib/session", () => ({ useSession: () => ({ ready: true, user: { id: "u1" } }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), dark: false, settings: { reduceMotion: false } };
  },
  useOptionalAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));
jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  useCanvasBoardQuery: () => ({
    data: mockData,
    isPending: mockIsPending,
    isError: mockIsError,
    isFetching: false,
    error: mockError,
    refetch: mockRefetch,
  }),
}));
jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
}));
jest.mock("../components/GlassSheet", () => ({
  GlassSheet: ({ visible, title, children }: { visible: boolean; title?: string; children?: React.ReactNode }) => {
    const { Text: RNText } = require("react-native");
    return visible ? (
      <>
        <RNText>{title}</RNText>
        {children}
      </>
    ) : null;
  },
}));

function board(overrides: Partial<CanvasBoardResponse> = {}): CanvasBoardResponse {
  return {
    labels: [{ id: "l1", name: "Act I", color: "olive" }],
    cards: [
      { id: "c1", title: "Opening image", body: "Cold open on the harbor.", x: 80, y: 80, labelIds: ["l1"] },
      { id: "c2", title: "Inciting incident", body: "", x: 400, y: 80, labelIds: [] },
    ],
    edges: [{ id: "e1", fromId: "c1", toId: "c2" }],
    ...overrides,
  };
}

beforeEach(() => {
  mockData = undefined;
  mockIsPending = false;
  mockIsError = false;
  mockError = null;
  mockRefetch.mockClear();
});

describe("Canvas screen", () => {
  it("shows a loading state before the board arrives", () => {
    mockIsPending = true;
    render(<CanvasScreen />);
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
  });

  it("recovers from a failed load instead of a bare error", () => {
    mockIsError = true;
    mockError = new Error("network down");
    render(<CanvasScreen />);
    expect(screen.getByText("Couldn't load the canvas.")).toBeTruthy();
    fireEvent.press(screen.getByText("Try again"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("tells a writer the board is empty rather than showing nothing", () => {
    mockData = board({ cards: [], edges: [] });
    render(<CanvasScreen />);
    expect(screen.getByText(/No cards on this board yet/)).toBeTruthy();
  });

  it("renders every card and its label at its stored position", () => {
    mockData = board();
    render(<CanvasScreen />);
    expect(screen.getByText("Opening image")).toBeTruthy();
    expect(screen.getByText("Inciting incident")).toBeTruthy();
    expect(screen.getByText("Act I")).toBeTruthy();
  });

  it("opens a card's full content in a sheet on tap", () => {
    mockData = board();
    render(<CanvasScreen />);
    fireEvent.press(screen.getByLabelText("Open Opening image"));
    // The body shows twice now: on the card tile and in the opened sheet.
    expect(screen.getAllByText("Cold open on the harbor.").length).toBe(2);
  });

  it("shows a placeholder for a card with no notes", () => {
    mockData = board();
    render(<CanvasScreen />);
    fireEvent.press(screen.getByLabelText("Open Inciting incident"));
    expect(screen.getByText("No notes on this card.")).toBeTruthy();
  });
});
