import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ReaderCommentsPill } from "../components/ReaderCommentsPill";
import { useShareCommentsQuery } from "../lib/api";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../lib/api", () => ({ useShareCommentsQuery: jest.fn() }));

const listMock = useShareCommentsQuery as jest.Mock;

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

describe("ReaderCommentsPill", () => {
  beforeEach(() => mockPush.mockClear());

  it("counts this chapter's open comments and opens them", () => {
    listMock.mockReturnValue({ data: [{ chapterId: "c1" }, { chapterId: "c2" }, { chapterId: "c1" }] });
    render(wrap(<ReaderCommentsPill projectId="p1" chapterId="c1" />));
    fireEvent.press(screen.getByLabelText("2 reader comments"));
    expect(listMock).toHaveBeenCalledWith("p1", "open");
    expect(mockPush).toHaveBeenCalledWith("/project/p1/beta-readers?chapterId=c1");
  });

  it("stays out of the way when the chapter has none", () => {
    listMock.mockReturnValue({ data: [{ chapterId: "c2" }] });
    render(wrap(<ReaderCommentsPill projectId="p1" chapterId="c1" />));
    expect(screen.queryByTestId("reader-comments-pill")).toBeNull();
  });
});
