import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { KnowledgeBoard } from "../components/KnowledgeBoard";
import {
  useBibleFileQuery,
  useBibleIndexQuery,
  useChaptersQuery,
  useCreateKnowledgeFactMutation,
  useKnowledgeFactsQuery,
  usePatchKnowledgeFactMutation,
  useRetireKnowledgeFactMutation,
} from "../lib/api";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const mockTrack = jest.fn();
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));

jest.mock("../lib/api", () => ({
  useBibleFileQuery: jest.fn(),
  useBibleIndexQuery: jest.fn(),
  useChaptersQuery: jest.fn(),
  useKnowledgeFactsQuery: jest.fn(),
  useCreateKnowledgeFactMutation: jest.fn(),
  usePatchKnowledgeFactMutation: jest.fn(),
  useRetireKnowledgeFactMutation: jest.fn(),
}));

const shop = { id: "c1", title: "The Shop", order: 0 };
const attic = { id: "c2", title: "The Attic", order: 1 };
const chapters = [attic, shop];

function fact(over: Record<string, unknown>) {
  return {
    id: "f",
    characterPath: "characters/joe.md",
    fact: "",
    stance: "knows",
    topic: null,
    chapterId: null,
    chapter: null,
    supersededAtChapterId: null,
    supersededAtChapter: null,
    sourceQuote: "",
    status: "active",
    ...over,
  };
}

const facts = [
  fact({
    id: "f-unaware",
    fact: "Who has the pen",
    stance: "unaware",
    topic: "who has the pen",
    status: "superseded",
    supersededAtChapterId: "c2",
    supersededAtChapter: attic,
  }),
  fact({
    id: "f-suspects",
    fact: "Suzy has the pen",
    stance: "suspects",
    topic: "who has the pen",
    chapterId: "c2",
    chapter: attic,
  }),
  fact({ id: "f-key", fact: "The shop key hangs by the door" }),
  fact({ id: "f-old", fact: "The pen is lost for good", status: "superseded" }),
  fact({
    id: "f-suzy",
    characterPath: "characters/suzy.md",
    fact: "She has the pen",
    topic: "Who has the pen",
    chapterId: "c1",
    chapter: shop,
  }),
];

function setup() {
  const create = jest.fn(async () => ({}));
  const patch = jest.fn(async () => ({}));
  const retire = jest.fn(async () => ({}));
  (useBibleIndexQuery as jest.Mock).mockReturnValue({
    data: [
      { path: "canon.md", summary: "" },
      { path: "characters/joe.md", summary: "" },
      { path: "characters/suzy.md", summary: "" },
    ],
  });
  (useBibleFileQuery as jest.Mock).mockReturnValue({
    data: { path: "canon.md", content: "# Canon\n- Mara has had the pen since chapter 1.\n" },
    isPending: false,
  });
  (useChaptersQuery as jest.Mock).mockReturnValue({ data: chapters });
  (useKnowledgeFactsQuery as jest.Mock).mockReturnValue({
    data: { facts },
    isPending: false,
    isError: false,
  });
  (useCreateKnowledgeFactMutation as jest.Mock).mockReturnValue({ mutateAsync: create, isPending: false });
  (usePatchKnowledgeFactMutation as jest.Mock).mockReturnValue({ mutateAsync: patch, isPending: false });
  (useRetireKnowledgeFactMutation as jest.Mock).mockReturnValue({ mutateAsync: retire, isPending: false });
  return { create, patch, retire };
}

const card = (id: string) => within(screen.getByTestId(`knowledge-fact-${id}`));

describe("KnowledgeBoard (mobile)", () => {
  it("starts at the open chapter, with later knowledge held back", () => {
    setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c1" initialCharacterPath="characters/joe.md" />);
    expect(useKnowledgeFactsQuery).toHaveBeenLastCalledWith("p1", { includeRetired: true });
    expect(screen.getByTestId("knowledge-as-of")).toHaveTextContent("As of the end of Ch. 1: The Shop");
    expect(card("f-unaware").getByText("doesn't know")).toBeTruthy();
    expect(screen.getByText("Later in the story")).toBeTruthy();
    expect(card("f-suspects").getByText("from Ch. 2")).toBeTruthy();
    // Retired everywhere stays out of the timeline until asked for.
    expect(screen.queryByText("The pen is lost for good")).toBeNull();
    fireEvent.press(screen.getByText("Show retired everywhere (1)"));
    expect(screen.getByText("The pen is lost for good")).toBeTruthy();
  });

  it("shows the same character differently a chapter later, with what replaced the old view", () => {
    setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c1" initialCharacterPath="characters/joe.md" />);
    fireEvent.press(screen.getByLabelText("Later chapter"));
    expect(screen.getByTestId("knowledge-as-of")).toHaveTextContent("As of the end of Ch. 2: The Attic");
    expect(card("f-unaware").getByText("until Ch. 2")).toBeTruthy();
    expect(card("f-unaware").getByText(/then suspects: Suzy has the pen/)).toBeTruthy();
    expect(card("f-suspects").getByText("Edit")).toBeTruthy();
    expect(screen.queryByText("Later in the story")).toBeNull();
    fireEvent.press(screen.getByLabelText("Earlier chapter"));
    fireEvent.press(screen.getByLabelText("Earlier chapter"));
    expect(screen.getByTestId("knowledge-as-of")).toHaveTextContent("Before the story opens");
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("knowledge_scrubber_used", {});
  });

  it("stops a fact at the chapter in view, and retires one that began there everywhere", async () => {
    const { retire } = setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c2" initialCharacterPath="characters/joe.md" />);
    await act(async () => {
      fireEvent.press(card("f-key").getByText("Stops here"));
    });
    expect(retire).toHaveBeenLastCalledWith({
      projectId: "p1",
      factId: "f-key",
      characterPath: "characters/joe.md",
      asOfChapterId: "c2",
    });
    await act(async () => {
      fireEvent.press(card("f-suspects").getByText("Retire"));
    });
    expect(retire).toHaveBeenLastCalledWith({
      projectId: "p1",
      factId: "f-suspects",
      characterPath: "characters/joe.md",
      asOfChapterId: null,
    });
  });

  it("records a change of view at the chapter in view", async () => {
    const { create } = setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c2" initialCharacterPath="characters/joe.md" />);
    fireEvent.press(card("f-key").getByText("Changes here"));
    expect(screen.getByText("From Ch. 2, Joe now:")).toBeTruthy();
    fireEvent.changeText(screen.getByDisplayValue("The shop key hangs by the door"), "The key is gone");
    fireEvent.press(screen.getAllByText("believes wrongly")[0]);
    await act(async () => {
      fireEvent.press(screen.getByText("Save change"));
    });
    expect(create).toHaveBeenCalledWith({
      projectId: "p1",
      body: {
        characterPath: "characters/joe.md",
        fact: "The key is gone",
        stance: "believes_wrong",
        topic: null,
        chapterId: "c2",
        replacesFactId: "f-key",
      },
    });
  });

  it("adds a fact from the chapter in view with a stance and a topic", async () => {
    const { create } = setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c2" />);
    fireEvent.changeText(screen.getByPlaceholderText("What they know, suspect, or have wrong"), "Suzy is lying");
    const suspects = screen.getAllByText("suspects");
    fireEvent.press(suspects[suspects.length - 1]);
    fireEvent.press(screen.getAllByText("who has the pen").slice(-1)[0]);
    await act(async () => {
      fireEvent.press(screen.getByText("Add"));
    });
    expect(create).toHaveBeenCalledWith({
      projectId: "p1",
      body: {
        characterPath: "characters/joe.md",
        fact: "Suzy is lying",
        stance: "suspects",
        topic: "who has the pen",
        chapterId: "c2",
      },
    });
  });

  it("edits a fact in place, moving it to another chapter", async () => {
    const { patch } = setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c2" initialCharacterPath="characters/joe.md" />);
    fireEvent.press(card("f-key").getByText("Edit"));
    fireEvent.changeText(
      screen.getByDisplayValue("The shop key hangs by the door"),
      "The shop key hangs by the back door"
    );
    fireEvent.press(screen.getAllByText("1. The Shop")[0]);
    await act(async () => {
      fireEvent.press(screen.getByText("Save"));
    });
    expect(patch).toHaveBeenCalledWith({
      projectId: "p1",
      factId: "f-key",
      characterPath: "characters/joe.md",
      body: { fact: "The shop key hangs by the back door", stance: "knows", chapterId: "c1", topic: null },
    });
  });

  it("lines characters up by topic as of the chapter, with the reader's canon line", () => {
    setup();
    render(<KnowledgeBoard projectId="p1" activeChapterId="c1" />);
    fireEvent.press(screen.getByText("By topic"));
    expect(screen.getAllByText("who has the pen").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Joe doesn't know: Who has the pen")).toBeTruthy();
    expect(screen.getByLabelText("Suzy knows: She has the pen")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Later chapter"));
    expect(screen.getByLabelText("Joe suspects: Suzy has the pen")).toBeTruthy();

    fireEvent.press(screen.getByText("Reader column"));
    expect(screen.getByText("Not in canon.md")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Joe suspects: Suzy has the pen"));
    expect(screen.getByTestId("knowledge-fact-f-suspects")).toBeTruthy();
  });
});
