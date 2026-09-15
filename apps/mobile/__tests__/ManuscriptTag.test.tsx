import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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

  it("shows the new genre while the save is still in flight", async () => {
    let release: () => void = () => {};
    const onSave = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const { unmount } = render(<ManuscriptTag genre="Mystery" onSave={onSave} />);
    fireEvent.press(screen.getByLabelText("Genre: Mystery. Edit"));
    fireEvent.changeText(screen.getByLabelText("Genre"), "Noir");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    // The request is still open, and the tag already reads the new genre —
    // the old one never gets a frame to itself.
    await waitFor(() => expect(screen.getByLabelText("Genre: Noir. Edit")).toBeTruthy());
    expect(screen.queryByLabelText("Genre")).toBeNull();
    await act(async () => {
      release();
    });
    unmount();
  });

  it("hands the tag over to the genre the server actually stored", async () => {
    const onSave = jest.fn(async () => {});
    const { rerender, unmount } = render(<ManuscriptTag genre="Mystery" onSave={onSave} />);
    fireEvent.press(screen.getByLabelText("Genre: Mystery. Edit"));
    fireEvent.changeText(screen.getByLabelText("Genre"), "noir");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("noir"));
    // The project reloads with the genre tidied on the way in; the chip follows
    // the stored value rather than holding the typed one forever.
    rerender(<ManuscriptTag genre="Noir" onSave={onSave} />);
    await waitFor(() => expect(screen.getByLabelText("Genre: Noir. Edit")).toBeTruthy());
    unmount();
  });

  it("takes the tag back to the saved genre when the server refuses", async () => {
    const onSave = jest.fn(async () => {
      throw new Error("nope");
    });
    const { unmount } = render(
      <ManuscriptTag genre="Mystery" error="Couldn't save the genre." onSave={onSave} />
    );
    fireEvent.press(screen.getByLabelText("Genre: Mystery. Edit"));
    fireEvent.changeText(screen.getByLabelText("Genre"), "Noir");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Noir"));
    // The rejected words are handed back rather than dropped.
    expect(screen.getByLabelText("Genre").props.value).toBe("Noir");
    // And the tag is on the saved genre again: retyping it saves nothing.
    fireEvent.changeText(screen.getByLabelText("Genre"), "Mystery");
    fireEvent(screen.getByLabelText("Genre"), "submitEditing");
    await waitFor(() => expect(screen.getByLabelText("Genre: Mystery. Edit")).toBeTruthy());
    expect(onSave).toHaveBeenCalledTimes(1);
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
