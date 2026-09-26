import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { NewManuscriptForm } from "../components/NewManuscriptForm";
import { ApiError } from "../lib/api";
import { createManuscript } from "../lib/manuscripts";

jest.mock("../lib/manuscripts", () => ({
  createManuscript: jest.fn(),
}));

const createManuscriptMock = createManuscript as jest.MockedFunction<typeof createManuscript>;

describe("NewManuscriptForm", () => {
  it("prefills the author and creates a manuscript", async () => {
    const onCreated = jest.fn();
    const project = {
      id: "p1",
      title: "Night Watch",
      author: "Ada",
      genre: "Mystery",
      logline: "",
      synopsis: "",
      chapters: [{ id: "c1", title: "Chapter 1" }],
    };
    createManuscriptMock.mockResolvedValueOnce(project as never);

    render(<NewManuscriptForm defaultAuthor="Ada" onCreated={onCreated} />);

    fireEvent.changeText(screen.getByLabelText("Title"), "Night Watch");
    fireEvent.changeText(screen.getByLabelText("Genre"), "Mystery");
    fireEvent.press(screen.getByLabelText("Create manuscript"));

    await waitFor(() => {
      expect(createManuscriptMock).toHaveBeenCalledWith({
        title: "Night Watch",
        author: "Ada",
        genre: "Mystery",
      });
      expect(onCreated).toHaveBeenCalledWith(project);
    });
  });

  it("shows the API error and stays on the form", async () => {
    createManuscriptMock.mockRejectedValueOnce(new ApiError("Authentication required.", 401));
    const onCreated = jest.fn();

    render(<NewManuscriptForm onCreated={onCreated} />);
    fireEvent.press(screen.getByLabelText("Create manuscript"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication required.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Create manuscript")).toHaveTextContent("Create manuscript");
  });

  it("creates a screenplay, and a blog post with a subtitle", async () => {
    createManuscriptMock.mockResolvedValue({ id: "p2" } as never);
    const onCreated = jest.fn();
    const { unmount } = render(<NewManuscriptForm defaultAuthor="Ada" onCreated={onCreated} />);

    fireEvent.press(screen.getByLabelText("Screenplay"));
    fireEvent.changeText(screen.getByLabelText("Title"), "Heist");
    fireEvent.press(screen.getByLabelText("Create screenplay"));
    await waitFor(() =>
      expect(createManuscriptMock).toHaveBeenLastCalledWith({
        title: "Heist",
        author: "Ada",
        genre: "",
        kind: "screenplay",
      })
    );
    unmount();

    render(<NewManuscriptForm defaultAuthor="Ada" onCreated={onCreated} />);
    fireEvent.press(screen.getByLabelText("Blog post or newsletter"));
    fireEvent.changeText(screen.getByLabelText("Title"), "Ten notes");
    fireEvent.changeText(screen.getByLabelText("Subtitle"), "What I learned");
    fireEvent.press(screen.getByLabelText("Create blog post or newsletter"));
    await waitFor(() =>
      expect(createManuscriptMock).toHaveBeenLastCalledWith({
        title: "Ten notes",
        author: "Ada",
        genre: "",
        kind: "blog",
        logline: "What I learned",
      })
    );
  });

  it("hides genre for a journal", () => {
    render(<NewManuscriptForm onCreated={jest.fn()} />);
    expect(screen.getByLabelText("Genre")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Journal"));
    expect(screen.queryByLabelText("Genre")).toBeNull();
    expect(screen.getByLabelText("Create journal")).toBeTruthy();
  });
});
