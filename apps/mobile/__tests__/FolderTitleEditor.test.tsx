import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FolderTitleEditor } from "../components/FolderTitleEditor";

describe("FolderTitleEditor", () => {
  it("shows the folder name as text with an edit control", () => {
    const { unmount } = render(
      <FolderTitleEditor name="Test Manuscripts" notes="" onSave={jest.fn()} />
    );
    expect(screen.getByLabelText("Test Manuscripts")).toBeTruthy();
    expect(screen.getByLabelText("Edit folder name and notes")).toBeTruthy();
    expect(screen.queryByLabelText("Folder name")).toBeNull();
    unmount();
  });

  it("opens the name and notes fields from the edit control", () => {
    const { unmount } = render(
      <FolderTitleEditor name="Test Manuscripts" notes="A cycle" onSave={jest.fn()} />
    );
    fireEvent.press(screen.getByLabelText("Edit folder name and notes"));
    expect(screen.getByLabelText("Folder name").props.value).toBe("Test Manuscripts");
    expect(screen.getByLabelText("Notes").props.value).toBe("A cycle");
    expect(screen.getByLabelText("Save folder")).toBeTruthy();
    unmount();
  });

  it("saves the trimmed name and notes, then shows the new title", async () => {
    const onSave = jest.fn(async () => {});
    const { unmount } = render(
      <FolderTitleEditor name="Test Manuscripts" notes="" onSave={onSave} />
    );
    fireEvent.press(screen.getByLabelText("Edit folder name and notes"));
    fireEvent.changeText(screen.getByLabelText("Folder name"), "  Night Cycle  ");
    fireEvent.changeText(screen.getByLabelText("Notes"), "  Linked  ");
    fireEvent.press(screen.getByLabelText("Save folder"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Night Cycle", "Linked"));
    expect(screen.getByLabelText("Night Cycle")).toBeTruthy();
    expect(screen.queryByLabelText("Folder name")).toBeNull();
    unmount();
  });

  it("keeps the new title up while the save is still in flight", async () => {
    let release: () => void = () => {};
    const onSave = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const { unmount } = render(
      <FolderTitleEditor name="Test Manuscripts" notes="" onSave={onSave} />
    );
    fireEvent.press(screen.getByLabelText("Edit folder name and notes"));
    fireEvent.changeText(screen.getByLabelText("Folder name"), "Night Cycle");
    fireEvent.press(screen.getByLabelText("Save folder"));
    expect(screen.getByLabelText("Night Cycle")).toBeTruthy();
    expect(screen.queryByLabelText("Folder name")).toBeNull();
    release();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    unmount();
  });
});
