import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ManuscriptTag } from "../components/ManuscriptTag";

describe("ManuscriptTag", () => {
  it("offers an add control when the manuscript has no genre", () => {
    const { unmount } = render(<ManuscriptTag genre="" onSave={jest.fn()} />);
    expect(screen.getByLabelText("Add a genre tag")).toHaveTextContent("Add genre");
    unmount();
  });

  it("creates a genre from the add control", async () => {
    const onSave = jest.fn(async () => {});
    const { unmount } = render(<ManuscriptTag genre="" onSave={onSave} />);
    fireEvent.press(screen.getByLabelText("Add a genre tag"));
    fireEvent.changeText(screen.getByLabelText("Genre"), "  Mystery  ");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Mystery"));
    unmount();
  });

  it("edits an existing genre tag", async () => {
    const onSave = jest.fn(async () => {});
    const { unmount } = render(<ManuscriptTag genre="Mystery" onSave={onSave} />);
    fireEvent.press(screen.getByLabelText("Genre: Mystery. Edit"));
    fireEvent.changeText(screen.getByLabelText("Genre"), "Noir");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Noir"));
    unmount();
  });

  it("keeps the field open when saving fails", async () => {
    const onSave = jest.fn(async () => {
      throw new Error("nope");
    });
    const { unmount } = render(
      <ManuscriptTag genre="" error="Couldn't save the genre." onSave={onSave} />
    );
    fireEvent.press(screen.getByLabelText("Add a genre tag"));
    fireEvent.changeText(screen.getByLabelText("Genre"), "Mystery");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Mystery"));
    expect(screen.getByLabelText("Genre")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the genre.");
    unmount();
  });
});
