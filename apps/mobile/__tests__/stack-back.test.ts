import {
  appStackState,
  backPlan,
  canPop,
  hasScreenBelow,
  rootRouteName,
  type StackState,
} from "../lib/stack-back";

const stack = (names: string[], index = names.length - 1): StackState => ({
  index,
  routes: names.map((name) => ({ name })),
});

/** What the navigation container actually reports: expo-router's wrapper around the layout stack. */
const container = (inner: StackState): StackState => ({
  index: 0,
  routes: [{ name: "__root", state: inner }],
});

describe("appStackState", () => {
  it("looks through expo-router's __root wrapper to the layout stack", () => {
    const inner = stack(["manuscripts", "settings"]);
    expect(appStackState(container(inner))).toBe(inner);
  });

  it("returns a bare stack as it is", () => {
    const inner = stack(["manuscripts", "settings"]);
    expect(appStackState(inner)).toBe(inner);
  });

  it("stops at a wrapper that has not mounted its stack yet", () => {
    const bare: StackState = { index: 0, routes: [{ name: "__root" }] };
    expect(appStackState(bare)).toBe(bare);
    expect(canPop(bare)).toBe(false);
  });
});

describe("rootRouteName", () => {
  it("maps hrefs onto the root stack's route names", () => {
    expect(rootRouteName("/")).toBe("index");
    expect(rootRouteName("/manuscripts")).toBe("manuscripts");
    expect(rootRouteName("/settings")).toBe("settings");
    expect(rootRouteName("/project/p1/chapters")).toBe("project/[id]");
    expect(rootRouteName("/folder/f1")).toBe("folder/[id]");
    expect(rootRouteName("/manuscripts?from=x")).toBe("manuscripts");
  });
});

describe("backPlan", () => {
  it("pops when the screen is already underneath", () => {
    expect(backPlan(stack(["manuscripts", "project/[id]"]), "/manuscripts")).toBe("pop");
    expect(hasScreenBelow(stack(["index", "login"]), "/")).toBe(true);
  });

  it("sees through the container's wrapper, where every stack looks one deep", () => {
    // Reading the wrapper itself made back always replace, which skips the
    // pop transition entirely: the screen just cut to the list.
    expect(backPlan(container(stack(["manuscripts", "project/[id]"])), "/manuscripts")).toBe("pop");
    expect(canPop(container(stack(["manuscripts", "settings"])))).toBe(true);
    expect(canPop(container(stack(["settings"])))).toBe(false);
  });

  it("replaces when the app was restored straight onto the screen", () => {
    // Cold start onto the last manuscript: nothing is under it.
    expect(backPlan(stack(["project/[id]"]), "/manuscripts")).toBe("replace");
    // Sign-in reached by redirect once the session was gone: no welcome below.
    expect(backPlan(stack(["login"]), "/")).toBe("replace");
  });

  it("does not count the current screen or anything above it", () => {
    expect(backPlan(stack(["manuscripts"]), "/manuscripts")).toBe("replace");
    expect(backPlan(stack(["project/[id]", "manuscripts"], 0), "/manuscripts")).toBe("replace");
  });

  it("replaces before the navigator is ready", () => {
    expect(backPlan(undefined, "/manuscripts")).toBe("replace");
  });
});

describe("canPop", () => {
  it("only when there is a screen below", () => {
    expect(canPop(stack(["manuscripts", "settings"]))).toBe(true);
    expect(canPop(stack(["settings"]))).toBe(false);
    expect(canPop(undefined)).toBe(false);
  });
});
