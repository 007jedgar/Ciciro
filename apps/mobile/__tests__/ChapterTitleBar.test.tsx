import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ChapterTitleBar } from "../components/ChapterTitleBar";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

describe("ChapterTitleBar", () => {
  it("names the chapter and invites a title when it has none", () => {
    const { unmount } = render(
      wrap(<ChapterTitleBar kind="novel" number={3} title="Chapter 3" onRename={jest.fn()} />)
    );
    expect(screen.getByText("CHAPTER 3")).toBeTruthy();
    expect(screen.getByText("Add a title")).toBeTruthy();
    unmount();
  });

  it("shows a custom title and saves a new one on submit", async () => {
    const onRename = jest.fn(async () => {});
    const { unmount } = render(
      wrap(<ChapterTitleBar kind="novel" number={2} title="The Storm" onRename={onRename} />)
    );
    fireEvent.press(screen.getByLabelText("Rename The Storm"));
    const field = screen.getByLabelText("Chapter title");
    expect(field.props.value).toBe("The Storm");
    fireEvent.changeText(field, "  After the Storm ");
    fireEvent(field, "submitEditing");
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("After the Storm"));
    unmount();
  });

  it("shows the new title while the save is still in flight", async () => {
    let finish: () => void = () => {};
    const onRename = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { unmount } = render(
      wrap(<ChapterTitleBar kind="novel" number={2} title="The Storm" onRename={onRename} />)
    );
    fireEvent.press(screen.getByLabelText("Rename The Storm"));
    const field = screen.getByLabelText("Chapter title");
    fireEvent.changeText(field, " After the Storm ");
    fireEvent(field, "submitEditing");
    expect(await screen.findByText("After the Storm")).toBeTruthy();
    expect(screen.queryByText("The Storm")).toBeNull();
    await act(async () => finish());
    unmount();
  });

  it("does not save when the title was left as it was", () => {
    const onRename = jest.fn(async () => {});
    const { unmount } = render(
      wrap(<ChapterTitleBar kind="novel" number={2} title="The Storm" onRename={onRename} />)
    );
    fireEvent.press(screen.getByLabelText("Rename The Storm"));
    fireEvent(screen.getByLabelText("Chapter title"), "blur");
    expect(onRename).not.toHaveBeenCalled();
    unmount();
  });

  it("says so when the save fails and puts the old title back", async () => {
    const onRename = jest.fn(async () => {
      throw new Error("offline");
    });
    const { unmount } = render(
      wrap(<ChapterTitleBar kind="novel" number={2} title="The Storm" onRename={onRename} />)
    );
    fireEvent.press(screen.getByLabelText("Rename The Storm"));
    const field = screen.getByLabelText("Chapter title");
    fireEvent.changeText(field, "Calm");
    fireEvent(field, "submitEditing");
    await waitFor(() => expect(screen.getByText("Couldn't save the title.")).toBeTruthy());
    expect(screen.getByText("The Storm")).toBeTruthy();
    unmount();
  });

  it("treats a journal entry's date and a blog post's title as the title itself", () => {
    const { rerender, unmount } = render(
      wrap(<ChapterTitleBar kind="journal" number={4} title="Monday, May 4" onRename={jest.fn()} />)
    );
    expect(screen.getByText("Monday, May 4")).toBeTruthy();
    expect(screen.queryByText(/^ENTRY/)).toBeNull();
    rerender(wrap(<ChapterTitleBar kind="blog" number={1} title="" onRename={jest.fn()} />));
    expect(screen.getByText("Add a title")).toBeTruthy();
    unmount();
  });
});
