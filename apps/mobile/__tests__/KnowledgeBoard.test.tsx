import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { KnowledgeBoard } from "../components/KnowledgeBoard";
import {
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

jest.mock("../lib/api", () => ({
  useBibleIndexQuery: jest.fn(),
  useChaptersQuery: jest.fn(),
  useKnowledgeFactsQuery: jest.fn(),
  useCreateKnowledgeFactMutation: jest.fn(),
  usePatchKnowledgeFactMutation: jest.fn(),
  useRetireKnowledgeFactMutation: jest.fn(),
}));

const chapters = [
  { id: "c6", title: "The Accusation", order: 6 },
  { id: "c1", title: "The Shop", order: 1 },
];

function fact(over: Record<string, unknown>) {
  return {
    id: "f",
    characterPath: "characters/joe.md",
    fact: "",
    stance: "knows",
    chapterId: null,
    chapter: null,
    status: "active",
    ...over,
  };
}

const facts = [
  fact({
    id: "f-believes",
    fact: "Suzy has the pen",
    stance: "believes",
    chapterId: "c6",
    chapter: chapters[0],
  }),
  fact({ id: "f-ch1", fact: "Nobody saw who took the pen", chapterId: "c1", chapter: chapters[1] }),
  fact({ id: "f-before", fact: "The shop key hangs by the door" }),
  fact({ id: "f-old", fact: "The pen is lost for good", status: "superseded" }),
  fact({ id: "f-suzy", characterPath: "characters/suzy.md", fact: "She has the pen" }),
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
  (useChaptersQuery as jest.Mock).mockReturnValue({ data: chapters });
  (useKnowledgeFactsQuery as jest.Mock).mockImplementation(
    (_id: string, params: { characterPath?: string }) => ({
      data: {
        facts: params.characterPath
          ? facts.filter((f) => f.characterPath === params.characterPath)
          : facts,
      },
      isPending: false,
      isError: false,
    })
  );
  (useCreateKnowledgeFactMutation as jest.Mock).mockReturnValue({ mutateAsync: create, isPending: false });
  (usePatchKnowledgeFactMutation as jest.Mock).mockReturnValue({ mutateAsync: patch, isPending: false });
  (useRetireKnowledgeFactMutation as jest.Mock).mockReturnValue({ mutateAsync: retire, isPending: false });
  return { create, patch, retire };
}

// Fact texts as they appear top to bottom in the rendered tree.
function factOrder(): string[] {
  const rendered = JSON.stringify(screen.toJSON());
  return facts
    .map((f) => f.fact)
    .filter((text) => rendered.includes(JSON.stringify(text)))
    .sort((a, b) => rendered.indexOf(JSON.stringify(a)) - rendered.indexOf(JSON.stringify(b)));
}

describe("KnowledgeBoard (mobile)", () => {
  it("lists each character's facts in chapter order, with before-story facts first and retired facts hidden", () => {
    setup();
    render(<KnowledgeBoard projectId="p1" />);
    expect(factOrder()).toEqual([
      "The shop key hangs by the door",
      "Nobody saw who took the pen",
      "Suzy has the pen",
      "She has the pen",
    ]);
    expect(screen.queryByText("The pen is lost for good")).toBeNull();

    fireEvent.press(screen.getByText("Show retired (1)"));
    expect(screen.getByText("The pen is lost for good")).toBeTruthy();
  });

  it("scopes to the character it was opened for", () => {
    setup();
    render(<KnowledgeBoard projectId="p1" initialCharacterPath="characters/suzy.md" />);
    expect(useKnowledgeFactsQuery).toHaveBeenLastCalledWith("p1", {
      characterPath: "characters/suzy.md",
      includeRetired: true,
    });
    expect(screen.getByText("She has the pen")).toBeTruthy();
    expect(screen.queryByText("Suzy has the pen")).toBeNull();
  });

  it("adds a fact with a stance and the chapter it was learned in", async () => {
    const { create } = setup();
    render(<KnowledgeBoard projectId="p1" />);
    const addSection = screen.getByPlaceholderText("What they know or believe");
    fireEvent.changeText(addSection, "Suzy is lying");
    const believes = screen.getAllByText("believes");
    fireEvent.press(believes[believes.length - 1]);
    const chapterChips = screen.getAllByText("The Accusation");
    fireEvent.press(chapterChips[chapterChips.length - 1]);
    await act(async () => {
      fireEvent.press(screen.getByText("Add"));
    });
    expect(create).toHaveBeenCalledWith({
      projectId: "p1",
      body: {
        characterPath: "characters/joe.md",
        fact: "Suzy is lying",
        stance: "believes",
        chapterId: "c6",
      },
    });
  });

  it("edits a fact in place, moving it to another chapter", async () => {
    const { patch } = setup();
    render(<KnowledgeBoard projectId="p1" initialCharacterPath="characters/joe.md" />);
    fireEvent.press(screen.getAllByText("Edit")[0]);
    const input = screen.getByDisplayValue("The shop key hangs by the door");
    fireEvent.changeText(input, "The shop key hangs by the back door");
    const shopChips = screen.getAllByText("The Shop");
    fireEvent.press(shopChips[0]);
    await act(async () => {
      fireEvent.press(screen.getByText("Save"));
    });
    expect(patch).toHaveBeenCalledWith({
      projectId: "p1",
      factId: "f-before",
      characterPath: "characters/joe.md",
      body: { fact: "The shop key hangs by the back door", stance: "knows", chapterId: "c1" },
    });
  });

  it("retires a fact", async () => {
    const { retire } = setup();
    render(<KnowledgeBoard projectId="p1" initialCharacterPath="characters/joe.md" />);
    await act(async () => {
      fireEvent.press(screen.getAllByText("Retire")[0]);
    });
    expect(retire).toHaveBeenCalledWith({
      projectId: "p1",
      factId: "f-before",
      characterPath: "characters/joe.md",
    });
  });
});
