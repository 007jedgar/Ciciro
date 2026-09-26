import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { WeeklyReview } from "../components/WeeklyReview";
import {
  useCreateWeeklyReviewMutation,
  useDeleteWeeklyReviewMutation,
  useWeeklyReviewsQuery,
} from "../lib/api";
import type { WeeklyReview as Review } from "../lib/api/types";

jest.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  useWeeklyReviewsQuery: jest.fn(),
  useCreateWeeklyReviewMutation: jest.fn(),
  useDeleteWeeklyReviewMutation: jest.fn(),
}));
jest.mock("../lib/api/client", () => ({ ApiError: class ApiError extends Error {} }));

const listMock = useWeeklyReviewsQuery as jest.Mock;
const createMock = useCreateWeeklyReviewMutation as jest.Mock;
const deleteMock = useDeleteWeeklyReviewMutation as jest.Mock;

function review(id: string, start: string, end: string, summary: string): Review {
  return {
    id,
    projectId: "p1",
    weekStart: start,
    weekEnd: end,
    createdAt: "",
    stats: {
      words: 900,
      daysWritten: 2,
      activeMs: 3_600_000,
      days: [
        { date: start, words: 0 },
        { date: end, words: 900 },
      ],
      chaptersTouched: [{ id: "c1", title: "The Ferry", wordCount: 1200 }],
      totalWords: 5000,
      chapterCount: 4,
      openQuestions: 1,
      openThreads: 1,
    },
    content: {
      summary,
      looseEnds: ["Who sent the letter?"],
      nextSteps: ["Write the harbour scene."],
    },
  };
}

const NEWER = review("r2", "2026-09-20", "2026-09-26", "A steady week.");
const OLDER = review("r1", "2026-09-13", "2026-09-19", "A quiet week.");

function mockApi(opts?: { reviews?: Review[]; due?: boolean; create?: jest.Mock }) {
  listMock.mockReturnValue({
    data: { reviews: opts?.reviews ?? [NEWER, OLDER], due: opts?.due ?? false },
    isPending: false,
    isError: false,
  });
  createMock.mockReturnValue({
    mutateAsync: opts?.create ?? jest.fn(async () => NEWER),
    isPending: false,
  });
  deleteMock.mockReturnValue({ mutateAsync: jest.fn(async () => ({ ok: true })), isPending: false });
}

describe("WeeklyReview", () => {
  it("shows the newest review with its loose ends and next steps", () => {
    mockApi();
    render(<WeeklyReview projectId="p1" />);
    expect(screen.getByText("A steady week.")).toBeTruthy();
    expect(screen.getByText("• Who sent the letter?")).toBeTruthy();
    expect(screen.getByText("• Write the harbour scene.")).toBeTruthy();
    expect(screen.getByText(/The Ferry/)).toBeTruthy();
  });

  it("rereads a past review", () => {
    mockApi();
    render(<WeeklyReview projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Open the review for Sep 13 to Sep 19"));
    expect(screen.getByText("A quiet week.")).toBeTruthy();
  });

  it("writes a review for today's window when one is due", async () => {
    const create = jest.fn(async () => NEWER);
    mockApi({ reviews: [], due: true, create });
    render(<WeeklyReview projectId="p1" />);
    expect(screen.getByText(/No reviews yet/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Review this week"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      projectId: "p1",
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      tzOffset: new Date().getTimezoneOffset(),
    });
  });

  it("shows an error when the review can't be written", async () => {
    mockApi({ create: jest.fn(async () => Promise.reject(new Error("boom"))) });
    render(<WeeklyReview projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Write a new review"));
    await waitFor(() => expect(screen.getByText("Couldn't write the review.")).toBeTruthy());
  });
});
