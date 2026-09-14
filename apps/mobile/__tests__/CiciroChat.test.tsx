import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { CiciroChat } from "../components/CiciroChat";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { ChatMessage } from "../lib/api/types";
import { emptyChatStreamState } from "../lib/ciciro-stream";
import { colors, makeLayout } from "../lib/theme";

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

describe("CiciroChat", () => {
  it("shows the empty prompt and does not send a blank composer", () => {
    const onSend = jest.fn();
    render(
      wrap(
        <CiciroChat
          messages={[]}
          stream={emptyChatStreamState()}
          streaming={false}
          error={null}
          phase={null}
          composer="   "
          onComposerChange={jest.fn()}
          onSend={onSend}
          onClear={jest.fn()}
          onInsertDraft={jest.fn()}
          insertedKeys={new Set()}
          bottomInset={0}
        />
      )
    );
    expect(
      screen.getByText(
        "Ask Ciciro about this manuscript, or pick Continue, Rewrite, or Describe from the writing tools."
      )
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends typed copy and inserts a closed draft into the manuscript", () => {
    const onSend = jest.fn();
    const onInsertDraft = jest.fn();
    render(
      wrap(
        <CiciroChat
          messages={[assistant]}
          stream={emptyChatStreamState()}
          streaming={false}
          error={null}
          phase={null}
          composer="Tighten the opening."
          onComposerChange={jest.fn()}
          onSend={onSend}
          onClear={jest.fn()}
          onInsertDraft={onInsertDraft}
          insertedKeys={new Set()}
          bottomInset={0}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText("Insert into manuscript"));
    expect(onInsertDraft).toHaveBeenCalledWith("The night was long.", "t1", 1);
  });
});
