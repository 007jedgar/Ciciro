import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, FlatList, StyleSheet } from "react-native";
import type { ReactNode } from "react";
import { CiciroChat } from "../components/CiciroChat";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { ChatMessage } from "../lib/api/types";
import { CLEAR_TIMING } from "../lib/chat-clear";
import { promptAnchorGap } from "../lib/chat-scroll";
import { classifyChatFailure } from "../lib/chat-errors";
import { emptyChatStreamState } from "../lib/ciciro-stream";
import { colors, makeLayout } from "../lib/theme";
import { LinearGradient } from "expo-linear-gradient";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
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

const AUTH_FOOTER =
  '401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}';

const idle = {
  messages: [] as ChatMessage[],
  stream: emptyChatStreamState(),
  streaming: false,
  failure: null,
  phase: null,
  onComposerChange: jest.fn(),
  onSend: jest.fn(),
  onStop: jest.fn(),
  onRetry: jest.fn(),
  onClear: jest.fn(async () => null),
  onUndoClear: jest.fn(),
  onInsertDraft: jest.fn(),
  insertedKeys: new Set<string>(),
  bottomInset: 0,
};

describe("CiciroChat", () => {
  it("shows the Allow edits / Chat only switch and reports a change", () => {
    const onEditModeChange = jest.fn();
    const { rerender } = render(
      wrap(<CiciroChat {...idle} composer="" editMode="edits" onEditModeChange={onEditModeChange} />)
    );
    expect(screen.getByRole("radio", { name: "Allow edits" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Chat only" }).props.accessibilityState.checked).toBe(false);

    fireEvent.press(screen.getByRole("radio", { name: "Chat only" }));
    expect(onEditModeChange).toHaveBeenCalledWith("chat");

    // Pressing the mode already chosen is not a change.
    onEditModeChange.mockClear();
    rerender(
      wrap(<CiciroChat {...idle} composer="" editMode="chat" onEditModeChange={onEditModeChange} />)
    );
    expect(screen.getByRole("radio", { name: "Chat only" }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "Chat only" }));
    expect(onEditModeChange).not.toHaveBeenCalled();
  });

  it("shows the empty prompt and hides send until there is text", () => {
    const onSend = jest.fn();
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="   " onSend={onSend} />)
    );
    expect(
      screen.getByText(
        "Ask Ciciro about this manuscript, or tap one of the suggestions below."
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText("Send")).toBeNull();

    rerender(wrap(<CiciroChat {...idle} composer="Tighten the opening." onSend={onSend} />));
    const send = screen.getByLabelText("Send");
    const rawStyle = send.props.style;
    const sendStyle = StyleSheet.flatten(
      typeof rawStyle === "function" ? rawStyle({ pressed: false }) : rawStyle
    );
    expect(sendStyle.width).toBe(sendStyle.height);
    expect(sendStyle.borderRadius).toBe(sendStyle.width / 2);
    expect(StyleSheet.flatten(screen.getByTestId("chat-composer").props.style).alignItems).toBe(
      "center"
    );
    unmount();
  });

  it("keeps the empty prompt upright inside the inverted list", () => {
    render(wrap(<CiciroChat {...idle} composer="" onSend={jest.fn()} />));
    // The inverted list flips its content; it hands the empty component the
    // counter-flip as `style`, which the component has to apply to its root.
    const prompt = screen.getByText(
      "Ask Ciciro about this manuscript, or tap one of the suggestions below."
    );
    // The Text's own parent is its composite; the next one up is the root View.
    const root = StyleSheet.flatten(prompt.parent?.parent?.props.style);
    expect(root.transform).toEqual([{ scaleY: -1 }]);
  });

  it("sits the empty prompt above the dock's fade, not under it", () => {
    render(wrap(<CiciroChat {...idle} composer="" onSend={jest.fn()} />));
    const dockHeight = 180;
    fireEvent(screen.getByTestId("chat-dock"), "layout", {
      nativeEvent: { layout: { height: dockHeight, width: 390, x: 0, y: 0 } },
    });
    const lead = -StyleSheet.flatten(screen.UNSAFE_getByType(LinearGradient).props.style).top;
    const prompt = screen.getByText(
      "Ask Ciciro about this manuscript, or tap one of the suggestions below."
    );
    // Inverted, both the container's paddingTop and the empty state's own
    // marginTop are the space between the dock's top edge and the prompt.
    const padding = StyleSheet.flatten(
      screen.getByTestId("chat-thread").props.contentContainerStyle
    ).paddingTop;
    const margin = StyleSheet.flatten(prompt.parent?.parent?.props.style).marginTop ?? 0;
    expect(padding - dockHeight + margin).toBeGreaterThanOrEqual(lead);
  });

  it("sends a quick action chip's id and hides the chips while a reply streams", () => {
    const onQuickAction = jest.fn();
    const quickActions = [
      { id: "critique-chapter", label: "Critique this chapter" },
      { id: "loose-ends", label: "Find loose ends" },
    ];
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="" quickActions={quickActions} onQuickAction={onQuickAction} />)
    );
    fireEvent.press(screen.getByLabelText("Find loose ends"));
    expect(onQuickAction).toHaveBeenCalledWith("loose-ends");

    rerender(
      wrap(
        <CiciroChat {...idle} streaming composer="" quickActions={quickActions} onQuickAction={onQuickAction} />
      )
    );
    expect(screen.queryByLabelText("Find loose ends")).toBeNull();
    unmount();
  });

  it("tucks the chips behind a Suggestions button once the conversation has begun", () => {
    const onQuickAction = jest.fn();
    const quickActions = [{ id: "loose-ends", label: "Find loose ends" }];
    const started = [assistant];
    render(
      wrap(
        <CiciroChat
          {...idle}
          messages={started}
          composer=""
          quickActions={quickActions}
          onQuickAction={onQuickAction}
        />
      )
    );
    expect(screen.queryByLabelText("Find loose ends")).toBeNull();
    fireEvent.press(screen.getByLabelText("Suggestions"));
    expect(screen.getByLabelText("Suggestions").props.accessibilityState.expanded).toBe(true);
    fireEvent.press(screen.getByLabelText("Find loose ends"));
    expect(onQuickAction).toHaveBeenCalledWith("loose-ends");
    expect(screen.queryByLabelText("Find loose ends")).toBeNull();
    expect(screen.getByLabelText("Suggestions").props.accessibilityState.expanded).toBe(false);
  });

  it("opens an empty chat with the chips out, and the Suggestions button folds and unfolds them", () => {
    render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          quickActions={[{ id: "loose-ends", label: "Find loose ends" }]}
          onQuickAction={jest.fn()}
        />
      )
    );
    expect(screen.getByLabelText("Find loose ends")).toBeTruthy();
    expect(screen.getByLabelText("Suggestions").props.accessibilityState.expanded).toBe(true);
    fireEvent.press(screen.getByLabelText("Suggestions"));
    expect(screen.queryByLabelText("Find loose ends")).toBeNull();
    expect(screen.getByLabelText("Suggestions").props.accessibilityState.expanded).toBe(false);
    fireEvent.press(screen.getByLabelText("Suggestions"));
    expect(screen.getByLabelText("Find loose ends")).toBeTruthy();
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

  it("sets a screenplay draft as a script and inserts the marked lines as sent", () => {
    const script: ChatMessage = {
      ...assistant,
      content: "A pass.\n<draft>.INT. LAB - NIGHT\n\n@MARA\n(low)\nStay quiet.</draft>",
    };
    const onInsertDraft = jest.fn();
    const { unmount } = render(
      wrap(<CiciroChat {...idle} screenplay messages={[script]} composer="" onInsertDraft={onInsertDraft} />)
    );
    // The card shows the pages, not the marks.
    expect(screen.getByTestId("script-draft")).toBeTruthy();
    expect(screen.getByText("INT. LAB - NIGHT")).toBeTruthy();
    expect(screen.getByText("MARA")).toBeTruthy();
    expect(screen.getByText("(low)")).toBeTruthy();
    expect(screen.queryByText(/@MARA/)).toBeNull();
    // The editor reads the marks back, so what goes in is the draft as written.
    fireEvent.press(screen.getByLabelText("Insert into manuscript"));
    expect(onInsertDraft).toHaveBeenCalledWith(".INT. LAB - NIGHT\n\n@MARA\n(low)\nStay quiet.", "t1", 1);
    unmount();
  });

  it("leaves a draft in any other kind as plain prose", () => {
    const { unmount } = render(wrap(<CiciroChat {...idle} messages={[assistant]} composer="" />));
    expect(screen.queryByTestId("script-draft")).toBeNull();
    expect(screen.getByText("The night was long.")).toBeTruthy();
    unmount();
  });

  it("swaps send for stop while a reply is streaming, and keeps typing alive", () => {
    const onStop = jest.fn();
    const onComposerChange = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          streaming
          composer="Still typing"
          onStop={onStop}
          onComposerChange={onComposerChange}
        />
      )
    );
    expect(screen.queryByLabelText("Send")).toBeNull();
    fireEvent.press(screen.getByLabelText("Stop"));
    expect(onStop).toHaveBeenCalledTimes(1);

    // A turn in flight must not lock the composer.
    const field = screen.getByLabelText("Message Ciciro");
    expect(field.props.editable).not.toBe(false);
    fireEvent.changeText(field, "Still typing more");
    expect(onComposerChange).toHaveBeenCalledWith("Still typing more");
    unmount();
  });

  it("keeps the last reply clear of the dock the thread scrolls under", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    fireEvent(screen.getByTestId("chat-dock"), "layout", {
      nativeEvent: { layout: { height: 180, width: 390, x: 0, y: 0 } },
    });
    // Inverted flips the content container's own top/bottom, so the dock
    // clearance the thread scrolls under is written here as paddingTop.
    const padding = StyleSheet.flatten(
      screen.getByTestId("chat-thread").props.contentContainerStyle
    ).paddingTop;
    expect(padding).toBeGreaterThanOrEqual(180);
    unmount();
  });

  it("fully hides prose scrolling under the dock's chrome, not just dims it", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    const dockHeight = 180;
    fireEvent(screen.getByTestId("chat-dock"), "layout", {
      nativeEvent: { layout: { height: dockHeight, width: 390, x: 0, y: 0 } },
    });
    const fade = screen.UNSAFE_getByType(LinearGradient);
    const { colors: stops, locations } = fade.props as {
      colors: string[];
      locations: number[];
    };
    // The fade starts `lead` px above the dock and runs to its bottom edge.
    const lead = -StyleSheet.flatten(fade.props.style).top;
    const total = lead + dockHeight;
    const opacityAt = (px: number) => {
      const t = px / total;
      const a = stops.map((c) => parseInt(c.slice(7, 9), 16) / 255);
      for (let i = 1; i < locations.length; i++) {
        if (t <= locations[i]) {
          const span = locations[i] - locations[i - 1];
          const k = span === 0 ? 1 : (t - locations[i - 1]) / span;
          return a[i - 1] + (a[i] - a[i - 1]) * k;
        }
      }
      return a[a.length - 1];
    };
    // Prose above the fade stays fully readable.
    expect(opacityAt(0)).toBe(0);
    // From the Clear chat row at the dock's top edge down through the composer
    // every pixel of the chrome sits on solid background.
    for (let y = lead; y <= total; y += 5) {
      expect(opacityAt(y)).toBe(1);
    }
    unmount();
  });

  it("opens a cached transcript already at its tail, with no empty state and no scroll call", () => {
    // An inverted list rests at offset 0 at its own tail from the very
    // first frame, cache-seeded or not - there is nothing to hide while a
    // scroll call lands, because no scroll call is ever needed.
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    const scrollToOffset = jest.spyOn(screen.UNSAFE_getByType(FlatList).instance, "scrollToOffset");
    expect(screen.getByText("A note.")).toBeTruthy();
    expect(scrollToOffset).not.toHaveBeenCalled();
    unmount();
  });

  it("shows a transcript that only arrives after mount at its tail too, the same as one seeded from cache", () => {
    const { rerender, unmount } = render(wrap(<CiciroChat {...idle} composer="" messages={[]} />));
    const scrollToOffset = jest.spyOn(screen.UNSAFE_getByType(FlatList).instance, "scrollToOffset");

    // Arrives after mount, like an uncached cold load.
    rerender(wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />));
    expect(screen.getByText("A note.")).toBeTruthy();
    expect(scrollToOffset).not.toHaveBeenCalled();
    unmount();
  });

  it("mounts only near the tail of a long transcript, not the whole history", () => {
    // `initialScrollIndex` and a full-mount-then-scrollToEnd were both tried
    // first (see git history) and both land wrong on-device with a long
    // thread - scroll offset estimation drifts over unmeasured rows, and a
    // "has it settled" heuristic races real (slow, markdown-heavy) batch
    // rendering. An inverted list sidesteps the problem: the resting
    // position is already the tail, so ordinary windowing only ever has to
    // mount what's near it.
    const long: ChatMessage[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Row ${i}`,
      kind: "chat",
      turnId: `t${Math.floor(i / 2)}`,
      createdAt: "2026-09-14T00:00:00.000Z",
    }));
    const { unmount } = render(wrap(<CiciroChat {...idle} composer="" messages={long} />));
    expect(screen.getByText("Row 59")).toBeTruthy();
    expect(screen.queryByText("Row 0")).toBeNull();
    unmount();
  });

  it("shows new rows from a background refetch with no explicit scroll call, whether or not the author has scrolled away", () => {
    // A background refetch (another device, a stopped turn re-caching) that
    // prepends newer rows needs no scroll call: those rows land at the
    // inverted list's own start, which is exactly where offset 0 is already
    // resting if the author has not scrolled away - and if they have, they
    // stay right where they are instead of being yanked back.
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    const scrollToOffset = jest.spyOn(screen.UNSAFE_getByType(FlatList).instance, "scrollToOffset");
    const scrollToEnd = jest.spyOn(screen.UNSAFE_getByType(FlatList).instance, "scrollToEnd");

    rerender(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          messages={[assistant, { ...assistant, id: "m3", content: "A reply from another device." }]}
        />
      )
    );

    expect(screen.getByText("A reply from another device.")).toBeTruthy();
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
    unmount();
  });

  it("lifts the composer onto the keyboard and keeps the tail in reach", () => {
    const keyboardState = jest.requireMock("react-native-keyboard-controller")
      .useKeyboardState as jest.Mock;
    const resting = keyboardState.getMockImplementation();
    keyboardState.mockImplementation((select: (s: unknown) => unknown) =>
      select({ isVisible: true, height: 300 })
    );
    try {
      const { unmount } = render(
        wrap(<CiciroChat {...idle} composer="" bottomInset={96} messages={[assistant]} />)
      );
      fireEvent(screen.getByTestId("chat-dock"), "layout", {
        nativeEvent: { layout: { height: 180, width: 390, x: 0, y: 0 } },
      });
      // The tab bar's reserve is handed back, so the dock rests on the keyboard
      // rather than floating a bar's height above it.
      expect(screen.getByTestId("chat-dock").props.offset).toEqual({ closed: 0, opened: 86 });
      const padding = StyleSheet.flatten(
        screen.getByTestId("chat-thread").props.contentContainerStyle
      ).paddingTop;
      expect(padding).toBe(180 + (300 + 10 - 96) + 16);
      unmount();
    } finally {
      keyboardState.mockImplementation(resting);
    }
  });

  it("renders a reply's markdown as formatting, not as stray markers", () => {
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          messages={[
            {
              ...assistant,
              id: "m3",
              content: "## Notes\n\nThe **opening** drags.\n\n- cut the weather",
            },
          ]}
        />
      )
    );
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByText("opening")).toBeTruthy();
    expect(screen.getByText("cut the weather")).toBeTruthy();
    expect(screen.queryByText(/\*\*opening\*\*/)).toBeNull();
    unmount();
  });

  it("turns a failed run's footer into a readable notice, not raw provider JSON", () => {
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          messages={[
            {
              ...assistant,
              id: "m4",
              content: `Here is the passage.\n\n[Ciciro error: ${AUTH_FOOTER}]`,
            },
          ]}
        />
      )
    );
    expect(screen.getByText("Here is the passage.")).toBeTruthy();
    expect(screen.queryByText(/authentication_error/)).toBeNull();
    expect(
      screen.getByText(
        "Ciciro could not reach the writing model — the server's API key was rejected. This needs a fix on the server, not another try."
      )
    ).toBeTruthy();
    // A rejected key will not fix itself, so retry is withheld.
    expect(screen.queryByLabelText("Try again")).toBeNull();

    // The provider's own words stay available behind the disclosure.
    fireEvent.press(screen.getByLabelText("Details"));
    expect(screen.getByText("API key is invalid.")).toBeTruthy();
    unmount();
  });

  it("offers Try again when the failure is transient", () => {
    const onRetry = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          onRetry={onRetry}
          failure={classifyChatFailure("Network request failed")}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("surfaces open questions above the thread", () => {
    const onOpenQuestions = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          openQuestionCount={2}
          onOpenQuestions={onOpenQuestions}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Ciciro has 2 open questions"));
    expect(onOpenQuestions).toHaveBeenCalledTimes(1);
    unmount();
  });

  describe("clearing", () => {
    /** Press Clear and take the destructive button in the confirm alert. */
    function confirmClear() {
      const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
        buttons?.find((button) => button.style === "destructive")?.onPress?.();
      });
      fireEvent.press(screen.getByLabelText("Clear chat"));
      alert.mockRestore();
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("collapses the thread, then offers Undo with the stamp the clear returned", async () => {
      const onClear = jest.fn(async () => "2026-09-14T00:00:00.000Z");
      const onUndoClear = jest.fn();
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={onClear}
            onUndoClear={onUndoClear}
          />
        )
      );

      confirmClear();
      expect(onClear).toHaveBeenCalledTimes(1);
      // Undo is not offered while the thread is still falling.
      expect(screen.queryByLabelText("Undo")).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      await waitFor(() => expect(screen.getByLabelText("Undo")).toBeTruthy());
      expect(screen.getByText("Chat cleared.")).toBeTruthy();

      fireEvent.press(screen.getByLabelText("Undo"));
      expect(onUndoClear).toHaveBeenCalledWith("2026-09-14T00:00:00.000Z");
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("withdraws the offer once it has stood long enough", async () => {
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={jest.fn(async () => "2026-09-14T00:00:00.000Z")}
          />
        )
      );
      confirmClear();
      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      await waitFor(() => expect(screen.getByLabelText("Undo")).toBeTruthy());

      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.offerMs + 10);
      });
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("offers no Undo when the server archived nothing", async () => {
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={jest.fn(async () => null)}
          />
        )
      );
      confirmClear();
      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("puts the thread back when the clear request fails", async () => {
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={jest.fn(async () => {
              throw new Error("offline");
            })}
          />
        )
      );
      confirmClear();
      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      // The conversation is still on the server, so it stays on screen.
      expect(screen.getByText("A note.")).toBeTruthy();
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("does not offer to clear an already empty conversation", () => {
      const onClear = jest.fn(async () => null);
      const { unmount } = render(
        wrap(<CiciroChat {...idle} composer="" messages={[]} onClear={onClear} />)
      );
      fireEvent.press(screen.getByLabelText("Clear chat"));
      expect(onClear).not.toHaveBeenCalled();
      unmount();
    });
  });

  it("shows the thinking mark while a reply is still forming", () => {
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="" streaming phase="running" />)
    );
    expect(screen.getByLabelText("Working")).toBeTruthy();

    // Once prose arrives the mark gives way to the words themselves.
    rerender(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          streaming
          phase="running"
          stream={{ ...emptyChatStreamState(), text: "She opened the door." }}
        />
      )
    );
    expect(screen.queryByLabelText("Working")).toBeNull();
    expect(screen.getByText("She opened the door.")).toBeTruthy();
    unmount();
  });

  // An inverted list rests at offset 0 at its own tail, so the scroll
  // offset already is the distance scrolled away from it.
  function scrollThread(distanceFromTail: number, layoutHeight = 600) {
    fireEvent.scroll(screen.getByTestId("chat-thread"), {
      nativeEvent: {
        contentOffset: { y: distanceFromTail, x: 0 },
        contentSize: { height: distanceFromTail + layoutHeight, width: 400 },
        layoutMeasurement: { height: layoutHeight, width: 400 },
      },
    });
  }

  it("fades the jump chip in only after two screens above the latest reply", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();

    scrollThread(600);
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();

    scrollThread(1200);
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();

    scrollThread(1200 + 300);
    expect(screen.getByLabelText("Scroll to latest")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Scroll to latest"));
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();
    unmount();
  });

  it("holds a new prompt at the top while the reply streams underneath", () => {
    const prompt: ChatMessage = {
      id: "u1",
      role: "user",
      content: "Tighten the opening.",
      kind: "chat",
      createdAt: "2026-09-14T00:00:00.000Z",
    };
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="" streaming messages={[prompt]} phase="running" />)
    );
    fireEvent(screen.getByTestId("chat-thread"), "layout", {
      nativeEvent: { layout: { height: 600, width: 390, x: 0, y: 0 } },
    });
    fireEvent(screen.getByTestId("chat-dock"), "layout", {
      nativeEvent: { layout: { height: 180, width: 390, x: 0, y: 0 } },
    });
    fireEvent(screen.getByTestId("chat-prompt"), "layout", {
      nativeEvent: { layout: { height: 48, width: 200, x: 0, y: 0 } },
    });

    const trailing = StyleSheet.flatten(
      screen.getByTestId("chat-thread").props.contentContainerStyle
    ).paddingTop;
    const gap = promptAnchorGap(600, 48, trailing);
    expect(StyleSheet.flatten(screen.getByTestId("chat-anchor").props.style).minHeight).toBe(gap);

    rerender(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          streaming
          messages={[prompt]}
          phase="running"
          stream={{ ...emptyChatStreamState(), text: "She opened the door." }}
        />
      )
    );
    expect(screen.getAllByText("She opened the door.")).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByTestId("chat-anchor").props.style).minHeight).toBe(gap);

    rerender(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          streaming={false}
          messages={[prompt, { ...assistant, content: "She opened the door." }]}
        />
      )
    );
    expect(screen.getAllByText("She opened the door.")).toHaveLength(1);
    expect(screen.queryByLabelText("Working")).toBeNull();
    fireEvent(screen.getByTestId("chat-settled-reply"), "layout", {
      nativeEvent: { layout: { height: 120, width: 390, x: 0, y: 0 } },
    });
    expect(StyleSheet.flatten(screen.getByTestId("chat-anchor").props.style).minHeight).toBe(
      gap - 120
    );
    unmount();
  });

  const prompt: ChatMessage = {
    id: "u1",
    role: "user",
    content: "Tighten the opening.",
    kind: "chat",
    createdAt: "2026-09-14T00:00:00.000Z",
  };
  const streamingReply = { ...emptyChatStreamState(), text: "She opened the door." };
  const heldPosition = () => screen.UNSAFE_getByType(FlatList).props.maintainVisibleContentPosition;

  function streamPrompt() {
    const view = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          streaming
          messages={[prompt]}
          phase="running"
          stream={streamingReply}
        />
      )
    );
    fireEvent(screen.getByTestId("chat-thread"), "layout", {
      nativeEvent: { layout: { height: 600, width: 390, x: 0, y: 0 } },
    });
    fireEvent(screen.getByTestId("chat-dock"), "layout", {
      nativeEvent: { layout: { height: 180, width: 390, x: 0, y: 0 } },
    });
    fireEvent(screen.getByTestId("chat-prompt"), "layout", {
      nativeEvent: { layout: { height: 48, width: 200, x: 0, y: 0 } },
    });
    return view;
  }

  it("has the list itself keep a streaming prompt's row still, with no scroll call per chunk", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" streaming messages={[prompt]} phase="running" />)
    );
    expect(heldPosition()).toBeUndefined();
    unmount();

    const view = streamPrompt();
    expect(heldPosition()).toEqual({ minIndexForVisible: 0 });
    const scrollToOffset = jest.spyOn(screen.UNSAFE_getByType(FlatList).instance, "scrollToOffset");
    for (const height of [800, 1400, 2600]) {
      fireEvent(screen.getByTestId("chat-anchor"), "layout", {
        nativeEvent: { layout: { height, width: 390, x: 0, y: 0 } },
      });
    }
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(heldPosition()).toEqual({ minIndexForVisible: 0 });
    view.unmount();
  });

  it("lets go of the prompt once the author drags the thread", () => {
    const { unmount } = streamPrompt();
    fireEvent(screen.getByTestId("chat-thread"), "scrollBeginDrag");
    expect(heldPosition()).toBeUndefined();
    unmount();
  });

  it("lets go of the prompt once the reply settles, and never holds a thread opened at rest", () => {
    const { rerender, unmount } = streamPrompt();
    rerender(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          streaming={false}
          messages={[prompt, { ...assistant, content: "She opened the door." }]}
        />
      )
    );
    expect(heldPosition()).toBeUndefined();
    unmount();

    const atRest = render(
      wrap(<CiciroChat {...idle} composer="" messages={[prompt, assistant]} />)
    );
    expect(heldPosition()).toBeUndefined();
    atRest.unmount();
  });
});
