import { describe, expect, it } from "vitest";
import { emptyStreak, evaluateReturnStreak } from "@/lib/gamification/streaks";
import { addLocalDays } from "@/lib/gamification/time";

const today = "2026-09-10";

function evalStreak(opts: {
  state?: ReturnType<typeof emptyStreak>;
  today?: string;
  closed: string[];
  scheduled?: string[] | ((date: string) => boolean);
  paused?: boolean;
}) {
  const scheduledSet = Array.isArray(opts.scheduled) ? new Set(opts.scheduled) : null;
  return evaluateReturnStreak({
    state: opts.state ?? emptyStreak(),
    today: opts.today ?? today,
    paused: opts.paused ?? false,
    isScheduled: (date) =>
      scheduledSet ? scheduledSet.has(date) : opts.scheduled instanceof Function
        ? opts.scheduled(date)
        : true,
    isClosed: (date) => opts.closed.includes(date),
  });
}

describe("recovery-first streaks", () => {
  it("opens a streak on the first closed scheduled day", () => {
    const { state, events } = evalStreak({ closed: [today] });
    expect(state.current).toBe(1);
    expect(state.best).toBe(1);
    expect(events.map((e) => e.kind)).toEqual(["closed"]);
  });

  it("increments on consecutive scheduled closes", () => {
    const first = evalStreak({ closed: ["2026-09-08"], today: "2026-09-08" });
    const second = evalStreak({
      state: first.state,
      closed: ["2026-09-08", "2026-09-09"],
      today: "2026-09-09",
    });
    expect(second.state.current).toBe(2);
    expect(second.state.best).toBe(2);
  });

  it("applies silent grace on a miss instead of resetting", () => {
    const closed = evalStreak({ closed: ["2026-09-08"], today: "2026-09-08" });
    const miss = evalStreak({
      state: closed.state,
      closed: ["2026-09-08"],
      today: "2026-09-09",
    });
    expect(miss.events.map((e) => e.kind)).toEqual(["grace"]);
    expect(miss.state.current).toBe(1);
    expect(miss.state.lastGraceLocalDate).toBe("2026-09-09");

    const resume = evalStreak({
      state: miss.state,
      closed: ["2026-09-08", "2026-09-10"],
      today: "2026-09-10",
    });
    expect(resume.state.current).toBe(2);
  });

  it("spends an earned freeze after grace is used in the window", () => {
    let state = emptyStreak();
    state.earnedFreezes = 1;
    state.lastGraceLocalDate = "2026-09-01";
    state.lastClosedLocalDate = "2026-09-08";
    state.lastEvaluatedLocalDate = "2026-09-08";
    state.current = 4;
    const miss = evalStreak({
      state,
      closed: ["2026-09-08"],
      today: "2026-09-09",
    });
    expect(miss.events.map((e) => e.kind)).toEqual(["freeze"]);
    expect(miss.state.earnedFreezes).toBe(0);
    expect(miss.state.current).toBe(4);
  });

  it("resets current (not best) when no freeze remains", () => {
    let state = emptyStreak();
    state.lastGraceLocalDate = "2026-09-01";
    state.lastClosedLocalDate = "2026-09-08";
    state.lastEvaluatedLocalDate = "2026-09-08";
    state.current = 12;
    state.best = 12;
    const miss = evalStreak({
      state,
      closed: ["2026-09-08"],
      today: "2026-09-09",
    });
    expect(miss.events.map((e) => e.kind)).toEqual(["reset"]);
    expect(miss.state.current).toBe(0);
    expect(miss.state.best).toBe(12);
  });

  it("does not treat an unscheduled day as a miss", () => {
    const first = evalStreak({
      closed: ["2026-09-08"],
      today: "2026-09-08",
      scheduled: ["2026-09-08", "2026-09-10"],
    });
    const rest = evalStreak({
      state: first.state,
      closed: ["2026-09-08"],
      today: "2026-09-09",
      scheduled: ["2026-09-08", "2026-09-10"],
    });
    expect(rest.events).toEqual([]);
    expect(rest.state.current).toBe(1);
  });

  it("neither increments nor resets while paused", () => {
    const first = evalStreak({ closed: ["2026-09-08"], today: "2026-09-08" });
    const paused = evalStreak({
      state: first.state,
      closed: ["2026-09-08"],
      today: "2026-09-09",
      paused: true,
    });
    expect(paused.events).toEqual([]);
    expect(paused.state.current).toBe(1);
  });

  it("does not judge today as a miss before the local day ends", () => {
    const first = evalStreak({ closed: ["2026-09-08"], today: "2026-09-08" });
    const same = evalStreak({
      state: first.state,
      closed: ["2026-09-08"],
      today: "2026-09-08",
    });
    expect(same.events).toEqual([]);
    expect(same.state.current).toBe(1);
  });

  it("earns a freeze every seven closed scheduled days, holding at most three", () => {
    let state = emptyStreak();
    let day = "2026-09-01";
    for (let i = 0; i < 21; i++) {
      const closed: string[] = [];
      // replay all closed dates so isClosed stays true
      let walk = "2026-09-01";
      while (walk <= day) {
        closed.push(walk);
        walk = addLocalDays(walk, 1);
      }
      const result = evalStreak({ state, closed, today: day });
      state = result.state;
      day = addLocalDays(day, 1);
    }
    expect(state.current).toBe(21);
    expect(state.earnedFreezes).toBe(3);
  });
});
