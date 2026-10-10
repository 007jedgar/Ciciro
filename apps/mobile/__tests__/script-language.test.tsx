import { fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "../lib/i18n";
import { ExportCard } from "../components/ExportCard";
import { exportManuscript } from "../lib/export";
import { ApiError } from "../lib/api/client";

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
    render(<ExportCard projectId="p1" kind="screenplay" />);
    expect(screen.getByLabelText("Export as Screenplay PDF")).toBeTruthy();
    expect(screen.getByLabelText("Export as Fountain")).toBeTruthy();
    expect(screen.getByTestId("export-beta-pdf")).toBeTruthy();
    expect(screen.getByTestId("export-beta-fountain")).toBeTruthy();
    expect(screen.queryByTestId("export-language-info")).toBeNull();
    expect(screen.queryByLabelText("Export as PDF")).toBeNull();
  });

  it("asks for the PDF and for Fountain by name", async () => {
    (exportManuscript as jest.Mock).mockResolvedValue(undefined);
    render(<ExportCard projectId="p1" kind="screenplay" />);
    fireEvent.press(screen.getByLabelText("Export as Fountain"));
    expect(exportManuscript).toHaveBeenCalledWith("p1", "fountain", expect.anything());
  });

  it("says why when the server cannot set the script", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new ApiError("nope", 422, null));
    render(<ExportCard projectId="p1" kind="screenplay" />);
    fireEvent.press(screen.getByLabelText("Export as Screenplay PDF"));
    expect(await screen.findByText(/only available in English and Spanish/)).toBeTruthy();
  });

  it("grays out the screenplay PDF in Chinese, with an info button, and leaves Fountain alone", async () => {
    await i18n.changeLanguage("zh");
    (exportManuscript as jest.Mock).mockClear();
    render(<ExportCard projectId="p1" kind="screenplay" />);
    const pdf = screen.getByLabelText("导出为 剧本 PDF");
    expect(pdf.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(pdf);
    expect(exportManuscript).not.toHaveBeenCalled();
    expect(screen.getByTestId("export-language-info")).toBeTruthy();
    expect(screen.getByLabelText("导出为 Fountain").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("is the plain book list for a novel", () => {
    render(<ExportCard projectId="p1" />);
    expect(screen.getByLabelText("Export as PDF")).toBeTruthy();
    expect(screen.queryByLabelText("Export as Fountain")).toBeNull();
  });
});
