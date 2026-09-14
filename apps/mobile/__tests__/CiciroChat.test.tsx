import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { CiciroChat } from "../components/CiciroChat";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { ChatMessage } from "../lib/api/types";
import { emptyChatStreamState } from "../lib/ciciro-stream";
import { colors, makeLayout } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

function wrap(ui: ReactNode) {
  const layout = makeLayout(colors);
  return (
    <AppThemeContext.Provider
      value={{
        settings: defaultSettings(),
        colors,
        layout,
        dark: false,
        patch: () => {},
      }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

const assistant: ChatMessage = {
  id: "m2",
  role: "assistant",
  content: "A note.\n<draft>The night was long.</draft>",
  kind: "chat",
  turnId: "t1",
  createdAt: "2026-09-14T00:00:00.000Z",
};

const idle = {
  messages: [] as ChatMessage[],
  stream: emptyChatStreamState(),
  streaming: false,
  error: null,
  phase: null,
  onComposerChange: jest.fn(),
  onSend: jest.fn(),
  onClear: jest.fn(),
  onInsertDraft: jest.fn(),
  insertedKeys: new Set<string>(),
  bottomInset: 0,
};

describe("CiciroChat", () => {
  it("shows the empty prompt and hides send until there is text", () => {
    const onSend = jest.fn();
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="   " onSend={onSend} />)
    );
    expect(
      screen.getByText(
        "Ask Ciciro about this manuscript, or pick Continue, Rewrite, or Describe from the writing tools."
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText("Send")).toBeNull();

    rerender(wrap(<CiciroChat {...idle} composer="Tighten the opening." onSend={onSend} />));
    expect(screen.getByLabelText("Send")).toBeTruthy();
    unmount();
  });

  it("sends typed copy and inserts a closed draft into the manuscript", () => {
    const onSend = jest.fn();
    const onInsertDraft = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          messages={[assistant]}
          composer="Tighten the opening."
          onSend={onSend}
          onInsertDraft={onInsertDraft}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText("Insert into manuscript"));
    expect(onInsertDraft).toHaveBeenCalledWith("The night was long.", "t1", 1);
    unmount();
  });

  it("keeps send hidden while a reply is streaming", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} streaming composer="Still typing" />)
    );
    expect(screen.queryByLabelText("Send")).toBeNull();
    unmount();
  });
});
