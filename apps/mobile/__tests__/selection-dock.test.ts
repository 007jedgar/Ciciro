import { renderHook, act } from "@testing-library/react-native";
import {
  DOCK_ACTIONS_ROW,
  DOCK_ROW_HEIGHT,
  DOCK_SYNONYMS_ROW,
  dockFrame,
  getSelectionDock,
  hasSynonymsRow,
  setSelectionDock,
  useSelectionDock,
  type SelectionDockModel,
} from "../lib/selection-dock";

const model: SelectionDockModel = {
  target: "word",
  word: "country",
  synonyms: { status: "idle", list: [] },
  onAction: jest.fn(),
  onSynonym: jest.fn(),
};

const place = { headerHeight: 210, safeTop: 59, focused: false, meterShown: true, synonymsRow: true };

describe("dockFrame", () => {
  it("covers the pills row and the meter row for a word, so the page under the header does not move", () => {
    expect(dockFrame(place)).toEqual({
      top: 210 - (DOCK_ACTIONS_ROW + DOCK_SYNONYMS_ROW),
      height: DOCK_ACTIONS_ROW + DOCK_SYNONYMS_ROW,
      stacked: true,
    });
  });

  it("covers only the pills row without synonyms, from the same top, leaving the meter showing", () => {
    expect(dockFrame({ ...place, synonymsRow: false })).toEqual({
      top: 210 - (DOCK_ACTIONS_ROW + DOCK_SYNONYMS_ROW),
      height: DOCK_ACTIONS_ROW,
      stacked: true,
    });
  });

  it("is one row at the header's bottom edge where the meter is off", () => {
    expect(dockFrame({ ...place, meterShown: false })).toEqual({
      top: 210 - DOCK_ROW_HEIGHT,
      height: DOCK_ROW_HEIGHT,
      stacked: false,
    });
  });

  it("sits just under the status bar while focus mode has the header away", () => {
    expect(dockFrame({ ...place, headerHeight: 95, focused: true })).toEqual({
      top: 59,
      height: DOCK_ROW_HEIGHT,
      stacked: false,
    });
  });

  it("never goes above the top of the screen", () => {
    expect(dockFrame({ ...place, headerHeight: 20, safeTop: 0 }).top).toBe(0);
    expect(dockFrame({ ...place, headerHeight: 20, safeTop: 0, meterShown: false }).top).toBe(0);
  });
});

describe("hasSynonymsRow", () => {
  it("is for a word whose lookup is running or has answered", () => {
    expect(hasSynonymsRow({ target: "word", synonyms: { status: "loading", list: [] } })).toBe(true);
    expect(hasSynonymsRow({ target: "word", synonyms: { status: "ready", list: ["a"] } })).toBe(true);
    expect(hasSynonymsRow({ target: "word", synonyms: { status: "none", list: [] } })).toBe(false);
    expect(hasSynonymsRow({ target: "word", synonyms: { status: "idle", list: [] } })).toBe(false);
  });

  it("is never for a passage", () => {
    expect(hasSynonymsRow({ target: "passage", synonyms: { status: "ready", list: ["a"] } })).toBe(false);
  });
});

describe("selection dock store", () => {
  afterEach(() => {
    act(() => setSelectionDock(null));
  });

  it("hands the published model to whoever draws it, and takes it back", () => {
    const { result } = renderHook(() => useSelectionDock());
    expect(result.current).toBeNull();
    act(() => setSelectionDock(model));
    expect(result.current).toBe(model);
    expect(getSelectionDock()).toBe(model);
    act(() => setSelectionDock(null));
    expect(result.current).toBeNull();
  });

  it("does not wake a reader for a model it already holds", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useSelectionDock();
    });
    act(() => setSelectionDock(model));
    const after = renders;
    act(() => setSelectionDock(model));
    expect(renders).toBe(after);
  });
});
