import { fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../lib/i18n";
import { ExportCard } from "../components/ExportCard";
import { exportManuscript } from "../lib/export";
import { ApiError } from "../lib/api/client";

const ENGLISH = [{ content: "<p>She waits by the window, and the rain keeps falling.</p>", archivedAt: null }];
const CHINESE = [{ content: "<p>他看着窗外的雨，什么也没说。</p>", archivedAt: null }];

jest.mock("../lib/export", () => ({
  ...jest.requireActual("../lib/export"),
  exportManuscript: jest.fn(),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({ getString: () => undefined, set: () => {} }),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
jest.mock("expo-sharing", () => ({}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), dark: false, settings: { reduceMotion: false, autoCorrect: true } };
  },
  useOptionalAppTheme: () => ({ settings: { reduceMotion: false } }),
}));

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ExportCard for a screenplay", () => {
  it("leads with the screenplay PDF and Fountain, both marked Beta", () => {
    render(<ExportCard projectId="p1" kind="screenplay" chapters={ENGLISH} />);
    expect(screen.getByLabelText("Export as Screenplay PDF")).toBeTruthy();
    expect(screen.getByLabelText("Export as Fountain")).toBeTruthy();
    expect(screen.getByTestId("export-beta-pdf")).toBeTruthy();
    expect(screen.getByTestId("export-beta-fountain")).toBeTruthy();
    expect(screen.queryByTestId("export-language-info")).toBeNull();
    expect(screen.queryByLabelText("Export as PDF")).toBeNull();
  });

  it("asks for the PDF and for Fountain by name", async () => {
    (exportManuscript as jest.Mock).mockResolvedValue(undefined);
    render(<ExportCard projectId="p1" kind="screenplay" chapters={ENGLISH} />);
    fireEvent.press(screen.getByLabelText("Export as Fountain"));
    expect(exportManuscript).toHaveBeenCalledWith("p1", "fountain", expect.anything());
  });

  it("says why when the server cannot set the script", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new ApiError("nope", 422, null));
    render(<ExportCard projectId="p1" kind="screenplay" chapters={ENGLISH} />);
    fireEvent.press(screen.getByLabelText("Export as Screenplay PDF"));
    expect(await screen.findByText(/only available in English and Spanish/)).toBeTruthy();
  });

  it("grays out the screenplay PDF for a Chinese script, even in English, with an info button, and leaves Fountain alone", () => {
    (exportManuscript as jest.Mock).mockClear();
    render(<ExportCard projectId="p1" kind="screenplay" chapters={CHINESE} />);
    const pdf = screen.getByLabelText("Export as Screenplay PDF");
    expect(pdf.props.accessibilityState).toMatchObject({ disabled: true });
    expect(pdf.props.accessibilityHint).toMatch(/only available in English and Spanish/);
    fireEvent.press(pdf);
    expect(exportManuscript).not.toHaveBeenCalled();
    expect(screen.getByTestId("export-language-info")).toBeTruthy();
    expect(screen.getByLabelText("Export as Fountain").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("exports an English script's PDF from a phone set to Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(<ExportCard projectId="p1" kind="screenplay" chapters={ENGLISH} />);
    expect(screen.getByLabelText("导出为 剧本 PDF").props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByTestId("export-language-info")).toBeNull();
  });

  it("leaves out archived sequences and pending suggestions, as the server's export does", () => {
    const chinese = "他看着窗外的雨，什么也没说。";
    render(
      <ExportCard
        projectId="p1"
        kind="screenplay"
        chapters={[
          ...ENGLISH,
          { content: `<p>${chinese}</p>`, archivedAt: "2026-01-01T00:00:00.000Z" },
          { content: `<p>Rain.<ins data-suggestion-id="sg-1" data-author-id="ciciro">${chinese}${chinese}</ins></p>`, archivedAt: null },
        ]}
      />
    );
    expect(screen.getByLabelText("Export as Screenplay PDF").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("is the plain book list for a novel", () => {
    render(<ExportCard projectId="p1" />);
    expect(screen.getByLabelText("Export as PDF")).toBeTruthy();
    expect(screen.queryByLabelText("Export as Fountain")).toBeNull();
  });
});
