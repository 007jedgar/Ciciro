import { Alert } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ManuscriptDetails } from "../components/ManuscriptDetails";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { ProjectDetail } from "../lib/types";
import { colors, makeLayout } from "../lib/theme";

const mockPatch = jest.fn();
const mockRemove = jest.fn();
let mockFolders: { id: string; name: string }[] = [];

jest.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  usePatchProjectMutation: () => ({ mutate: mockPatch, isPending: false }),
  useDeleteProjectMutation: () => ({ mutate: mockRemove, isPending: false }),
  useFoldersQuery: () => ({ data: mockFolders }),
}));

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

const project = {
  id: "p1",
  title: "Night Watch",
  author: "A. Writer",
  logline: "A guard hears a second heartbeat.",
  kind: "novel",
  folderId: null,
} as unknown as ProjectDetail;

describe("ManuscriptDetails", () => {
  beforeEach(() => {
    mockPatch.mockClear();
    mockRemove.mockClear();
    mockFolders = [];
  });

  it("saves only once something changed, with the trimmed values", () => {
    const { unmount } = render(wrap(<ManuscriptDetails project={project} onDeleted={jest.fn()} />));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText("Title"), "  Night Watch II ");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(mockPatch).toHaveBeenCalledWith(
      { id: "p1", body: { title: "Night Watch II", author: "A. Writer", logline: "A guard hears a second heartbeat." } },
      expect.any(Object)
    );
    unmount();
  });

  it("will not save a blank title", () => {
    const { unmount } = render(wrap(<ManuscriptDetails project={project} onDeleted={jest.fn()} />));
    fireEvent.changeText(screen.getByLabelText("Title"), "   ");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(mockPatch).not.toHaveBeenCalled();
    unmount();
  });

  it("files the manuscript into a folder, or back out, with one tap", () => {
    mockFolders = [{ id: "f1", name: "Trilogy" }];
    const { unmount } = render(wrap(<ManuscriptDetails project={project} onDeleted={jest.fn()} />));
    expect(screen.getByRole("radio", { name: "Unfiled" }).props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "Trilogy" }));
    expect(mockPatch).toHaveBeenCalledWith({ id: "p1", body: { folderId: "f1" } }, expect.any(Object));
    unmount();
  });

  it("hides the folder choices when there are no folders", () => {
    const { unmount } = render(wrap(<ManuscriptDetails project={project} onDeleted={jest.fn()} />));
    expect(screen.queryByText("Folder")).toBeNull();
    unmount();
  });

  it("asks before deleting, and deletes only once confirmed", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onDeleted = jest.fn();
    mockRemove.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    const { unmount } = render(wrap(<ManuscriptDetails project={project} onDeleted={onDeleted} />));
    fireEvent.press(screen.getByRole("button", { name: "Delete manuscript" }));
    expect(alert).toHaveBeenCalledWith("Delete “Night Watch”?", expect.stringContaining("permanently"), expect.any(Array));
    expect(mockRemove).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === "Delete")!.onPress!();
    expect(mockRemove).toHaveBeenCalledWith("p1", expect.any(Object));
    expect(onDeleted).toHaveBeenCalled();
    alert.mockRestore();
    unmount();
  });
});
