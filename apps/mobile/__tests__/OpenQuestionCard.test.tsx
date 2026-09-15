import { fireEvent, render, screen } from "@testing-library/react-native";
import { OpenQuestionCard } from "../components/OpenQuestionCard";
import type { OpenQuestion } from "../lib/api/types";
import { chatRequestFromAnswer } from "../lib/ciciro-intents";
import { colors } from "../lib/theme";

const question: OpenQuestion = {
  id: "q1",
  projectId: "p1",
  question: "Is Mara the elder sister or the younger?",
  provisional: "the elder",
  affects: "Chapter 2, bible/characters/mara.md",
  chapterId: "c2",
  status: "open",
  answer: "",
  resolution: "",
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

describe("OpenQuestionCard", () => {
  it("shows the fork and what the editor went with", () => {
    const { unmount } = render(
      <OpenQuestionCard
        question={question}
        colors={colors}
        chapterLabel="Chapter 2"
        onAnswer={jest.fn()}
        onDismiss={jest.fn()}
      />
    );
    expect(screen.getByText("Is Mara the elder sister or the younger?")).toBeTruthy();
    expect(screen.getByText("Went with: the elder")).toBeTruthy();
    expect(screen.getByText("Chapter 2, bible/characters/mara.md · Chapter 2")).toBeTruthy();
    unmount();
  });

  it("holds the answer back until something has been typed", () => {
    const onAnswer = jest.fn();
    const { unmount } = render(
      <OpenQuestionCard
        question={question}
        colors={colors}
        onAnswer={onAnswer}
        onDismiss={jest.fn()}
      />
    );
    fireEvent.press(screen.getByLabelText("Answer & reconcile"));
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText("Your answer"), "  The younger.  ");
    fireEvent.press(screen.getByLabelText("Answer & reconcile"));
    expect(onAnswer).toHaveBeenCalledWith("The younger.");
    unmount();
  });

  it("dismisses without sending an answer", () => {
    const onDismiss = jest.fn();
    const { unmount } = render(
      <OpenQuestionCard
        question={question}
        colors={colors}
        onAnswer={jest.fn()}
        onDismiss={onDismiss}
      />
    );
    fireEvent.press(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("chatRequestFromAnswer", () => {
  it("asks the editor to reconcile, not merely to tick the question off", () => {
    const input = chatRequestFromAnswer(question, "The younger.", {
      projectId: "p1",
      chapterId: "c2",
    });
    expect(input).toMatchObject({ projectId: "p1", kind: "reconcile", activeChapterId: "c2" });
    // The id lets the editor close the right row via resolve_question.
    expect(input?.message).toContain("[id: q1]");
    expect(input?.message).toContain("You provisionally went with: \"the elder\"");
    expect(input?.message).toContain("correct the affected prose and the bible");
  });

  it("sends nothing for a blank answer", () => {
    expect(chatRequestFromAnswer(question, "   ", { projectId: "p1", chapterId: null })).toBeNull();
  });
});
