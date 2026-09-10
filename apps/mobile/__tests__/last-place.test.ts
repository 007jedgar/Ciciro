import {
  applyPathname,
  DEFAULT_HREF,
  getLastManuscript,
  getLastPlace,
  getLastScreen,
  hrefForLastPlace,
  rememberPathname,
  resetLastPlace,
  restoreHref,
  unloadLastPlace,
} from "../lib/last-place";

const empty = { screen: DEFAULT_HREF, manuscriptId: null };

describe("applyPathname", () => {
  it("records manuscripts, settings, folders, and project tabs", () => {
    expect(applyPathname(empty, "/manuscripts")).toEqual({
      screen: "/manuscripts",
      manuscriptId: null,
    });
    expect(applyPathname({ screen: "/manuscripts", manuscriptId: "p1" }, "/settings")).toEqual({
      screen: "/settings",
      manuscriptId: "p1",
    });
    expect(applyPathname(empty, "/folder/fld_1")).toEqual({
      screen: "/folder/fld_1",
      manuscriptId: null,
    });
    expect(applyPathname(empty, "/project/p1/manuscript")).toEqual({
      screen: "/project/p1/manuscript",
      manuscriptId: "p1",
    });
    expect(applyPathname(empty, "/project/p1")).toEqual({
      screen: "/project/p1/chapters",
      manuscriptId: "p1",
    });
  });

  it("keeps the last manuscript when returning to the list", () => {
    const inProject = applyPathname(empty, "/project/p9/ciciro");
    expect(applyPathname(inProject!, "/manuscripts")).toEqual({
      screen: "/manuscripts",
      manuscriptId: "p9",
    });
  });

  it("ignores welcome, auth, and create screens", () => {
    expect(applyPathname(empty, "/")).toBeNull();
    expect(applyPathname(empty, "/login")).toBeNull();
    expect(applyPathname(empty, "/signup")).toBeNull();
    expect(applyPathname(empty, "/new-manuscript")).toBeNull();
    expect(applyPathname(empty, "/new-folder")).toBeNull();
    expect(applyPathname(empty, "/project/not valid")).toBeNull();
  });
});

describe("hrefForLastPlace", () => {
  it("returns the stored screen when it is a known route", () => {
    expect(hrefForLastPlace({ screen: "/project/p1/ciciro", manuscriptId: "p1" })).toBe(
      "/project/p1/ciciro"
    );
    expect(hrefForLastPlace({ screen: "/folder/f1", manuscriptId: "p1" })).toBe("/folder/f1");
  });

  it("falls back to the last manuscript, then the list", () => {
    expect(hrefForLastPlace({ screen: "/login", manuscriptId: "p1" })).toBe("/project/p1/chapters");
    expect(hrefForLastPlace({ screen: "/login", manuscriptId: null })).toBe(DEFAULT_HREF);
    expect(hrefForLastPlace(null)).toBe(DEFAULT_HREF);
  });
});

describe("rememberPathname", () => {
  beforeEach(() => {
    resetLastPlace();
  });

  it("keeps last screen and last manuscript in local variables across a reload", () => {
    rememberPathname("/project/p1/manuscript", "user-1");
    expect(getLastScreen()).toBe("/project/p1/manuscript");
    expect(getLastManuscript()).toBe("p1");
    expect(restoreHref("user-1")).toBe("/project/p1/manuscript");
  });

  it("does not restore another user's last place", () => {
    rememberPathname("/project/p1/chapters", "user-1");
    expect(getLastPlace("user-2")).toBeNull();
    expect(restoreHref("user-2")).toBe(DEFAULT_HREF);
  });

  it("does not overwrite last place on the welcome screen", () => {
    rememberPathname("/project/p1/chapters", "user-1");
    rememberPathname("/", "user-1");
    expect(getLastScreen()).toBe("/project/p1/chapters");
    expect(getLastManuscript()).toBe("p1");
  });

  it("restores last place from disk after memory is wiped", () => {
    rememberPathname("/project/p1/manuscript", "user-1");
    unloadLastPlace();
    expect(getLastScreen()).toBe("/project/p1/manuscript");
    expect(getLastManuscript()).toBe("p1");
    expect(restoreHref("user-1")).toBe("/project/p1/manuscript");
  });
});
