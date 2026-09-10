import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { NewFolderForm } from "../components/NewFolderForm";
import { ApiError } from "../lib/api";
import { createFolder } from "../lib/folders";

jest.mock("../lib/folders", () => ({
  createFolder: jest.fn(),
}));

const createFolderMock = createFolder as jest.MockedFunction<typeof createFolder>;

describe("NewFolderForm", () => {
  it("creates a folder with a trimmed name and notes", async () => {
    const onCreated = jest.fn();
    const folder = { id: "f1", name: "The Cycle", notes: "Linked novels.", projects: [] };
    createFolderMock.mockResolvedValueOnce(folder as never);

    render(<NewFolderForm onCreated={onCreated} />);
    fireEvent.changeText(screen.getByLabelText("Folder name"), "The Cycle");
    fireEvent.changeText(screen.getByLabelText("Notes"), "Linked novels.");
    fireEvent.press(screen.getByLabelText("Create folder"));

    await waitFor(() => {
      expect(createFolderMock).toHaveBeenCalledWith({
        name: "The Cycle",
        notes: "Linked novels.",
      });
      expect(onCreated).toHaveBeenCalledWith(folder);
    });
  });

  it("requires a name before calling the API", async () => {
    const onCreated = jest.fn();
    render(<NewFolderForm onCreated={onCreated} />);
    fireEvent.press(screen.getByLabelText("Create folder"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required.");
    expect(createFolderMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("shows the API error and stays on the form", async () => {
    createFolderMock.mockRejectedValueOnce(new ApiError("Authentication required.", 401));
    const onCreated = jest.fn();
    render(<NewFolderForm onCreated={onCreated} />);
    fireEvent.changeText(screen.getByLabelText("Folder name"), "Shelf");
    fireEvent.press(screen.getByLabelText("Create folder"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication required.");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
