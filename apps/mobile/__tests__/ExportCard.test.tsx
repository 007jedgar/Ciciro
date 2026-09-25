import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ExportCard } from "../components/ExportCard";
import { ExportUnavailableError, exportManuscript } from "../lib/export";

jest.mock("../lib/export", () => ({
  ...jest.requireActual("../lib/export"),
  exportManuscript: jest.fn(),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
jest.mock("expo-sharing", () => ({}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors) };
  },
}));

describe("ExportCard", () => {
  it("exports the chosen format", async () => {
    (exportManuscript as jest.Mock).mockResolvedValue(undefined);
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as PDF"));
    await waitFor(() => expect(exportManuscript).toHaveBeenCalledWith("p1", "pdf"));
  });

  it("shows an error when the export fails", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new Error("boom"));
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as EPUB"));
    expect(await screen.findByText("Could not export the manuscript.")).toBeTruthy();
  });

  it("explains when sharing is unavailable", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new ExportUnavailableError());
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as Word"));
    expect(await screen.findByText("Sharing is not available on this device.")).toBeTruthy();
  });
});
