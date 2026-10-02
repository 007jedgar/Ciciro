import { act, render } from "@testing-library/react-native";
import type { ReplicaReadingPosition } from "../lib/db";
import { ProjectProvider, useProject } from "../lib/project";

const mockSync = { position: null as ReplicaReadingPosition | null };

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  useCreateChapterMutation: () => ({ mutateAsync: jest.fn() }),
  useProjectQuery: () => ({
    data: {
      id: "p1",
      chapters: [
        { id: "c1", title: "One" },
        { id: "c2", title: "Two" },
        { id: "c3", title: "Three" },
      ],
    },
    isPending: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock("../lib/use-project-sync", () => ({
  useProjectSync: () => ({
    position: mockSync.position,
    recordPosition: jest.fn(),
    recordOp: jest.fn(),
    flushEdits: jest.fn(),
    settleChapter: jest.fn(),
    syncNow: jest.fn(),
  }),
}));

let state: ReturnType<typeof useProject>;
function Probe() {
  state = useProject();
  return null;
}

const tree = () => (
  <ProjectProvider projectId="p1">
    <Probe />
  </ProjectProvider>
);

function position(chapterId: string, updatedAt: string): ReplicaReadingPosition {
  return { id: "pos", userId: "u1", projectId: "p1", chapterId, blockId: "b1", offset: 0, updatedAt };
}

// A notification tap (or any deliberate pick) selects a chapter before the
// first sync has brought the saved reading position back.
describe("ProjectProvider chapter selection", () => {
  beforeEach(() => {
    mockSync.position = null;
  });

  it("keeps a chapter picked before an older reading position arrives", () => {
    const view = render(tree());
    act(() => state.setSelectedChapterId("c3"));
    mockSync.position = position("c2", new Date(Date.now() - 60_000).toISOString());
    view.rerender(tree());
    expect(state.selectedChapterId).toBe("c3");
  });

  it("still follows a reading position saved after the pick", () => {
    const view = render(tree());
    act(() => state.setSelectedChapterId("c3"));
    mockSync.position = position("c2", new Date(Date.now() + 60_000).toISOString());
    view.rerender(tree());
    expect(state.selectedChapterId).toBe("c2");
  });

  it("restores the reading position when nothing was picked", () => {
    mockSync.position = position("c2", "2026-01-01T00:00:00.000Z");
    render(tree());
    expect(state.selectedChapterId).toBe("c2");
  });
});
