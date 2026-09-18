import {
  createHeadWatcher,
  listenChapterHeads,
  type ChapterHeadStream,
} from "../lib/sync-poke";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function watcher(local: Record<string, number>) {
  let behind = 0;
  const handle = createHeadWatcher({
    onBehind: () => {
      behind += 1;
    },
    localRevision: (chapterId) => local[chapterId],
  });
  return { handle, behind: () => behind };
}

describe("createHeadWatcher", () => {
  it("pulls when the server is holding a newer revision", () => {
    const { handle, behind } = watcher({ c1: 3 });
    handle({ type: "heads", chapters: [{ id: "c1", revision: 4 }] });
    expect(behind()).toBe(1);
  });

  it("stays quiet when the revision is one we already have", () => {
    const { handle, behind } = watcher({ c1: 3 });
    handle({ type: "heads", chapters: [{ id: "c1", revision: 3 }] });
    expect(behind()).toBe(0);
  });

  it("stays quiet when the phone is ahead of the poke", () => {
    // Our own push has landed locally but its echo has not come back yet.
    const { handle, behind } = watcher({ c1: 5 });
    handle({ type: "heads", chapters: [{ id: "c1", revision: 4 }] });
    expect(behind()).toBe(0);
  });

  it("pulls for a chapter it has never seen", () => {
    const { handle, behind } = watcher({});
    handle({ type: "heads", chapters: [{ id: "c-desk", revision: 1 }] });
    expect(behind()).toBe(1);
  });

  it("asks for one pull however many chapters moved", () => {
    const { handle, behind } = watcher({ c1: 1, c2: 1 });
    handle({
      type: "heads",
      chapters: [
        { id: "c1", revision: 2 },
        { id: "c2", revision: 9 },
      ],
    });
    expect(behind()).toBe(1);
  });

  it("ignores keepalives, empty frames, and malformed heads", () => {
    const { handle, behind } = watcher({ c1: 1 });
    handle({ type: "ping" });
    handle({ type: "heads", chapters: [] });
    handle({ type: "heads" });
    handle({ type: "heads", chapters: [{ id: "", revision: 9 }, { revision: 9 }] });
    handle({ type: "done", status: "completed" });
    expect(behind()).toBe(0);
  });
});

describe("listenChapterHeads", () => {
  const options = {
    onBehind: () => {},
    localRevision: () => 0,
    backoffMs: () => 0,
  };

  it("reopens the channel after a drop", async () => {
    let opened = 0;
    const open: ChapterHeadStream = async () => {
      opened += 1;
      if (opened === 1) throw new Error("network request failed");
    };

    const stop = listenChapterHeads("p1", { ...options, open });
    await tick();
    await tick();
    await tick();
    stop();

    expect(opened).toBeGreaterThan(1);
  });

  it("delivers heads from the stream to the watcher", async () => {
    let behind = 0;
    const open: ChapterHeadStream = async (_projectId, onEvent) => {
      onEvent({ type: "ping" });
      onEvent({ type: "heads", chapters: [{ id: "c1", revision: 2 }] });
    };

    const stop = listenChapterHeads("p1", {
      onBehind: () => {
        behind += 1;
      },
      localRevision: () => 1,
      backoffMs: () => 0,
      open,
    });
    await tick();
    stop();

    expect(behind).toBeGreaterThanOrEqual(1);
  });

  it("stops reconnecting and aborts the open request on unsubscribe", async () => {
    let opened = 0;
    let aborted = false;
    const open: ChapterHeadStream = (_projectId, _onEvent, opts) =>
      new Promise((_resolve, reject) => {
        opened += 1;
        opts?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });

    const stop = listenChapterHeads("p1", { ...options, open });
    await tick();
    expect(opened).toBe(1);

    stop();
    await tick();
    await tick();

    expect(aborted).toBe(true);
    expect(opened).toBe(1);
  });

  it("passes the project id straight through to the stream", async () => {
    const ids: string[] = [];
    const open: ChapterHeadStream = async (projectId) => {
      ids.push(projectId);
      await new Promise(() => {});
    };

    const stop = listenChapterHeads("p-42", { ...options, open });
    await tick();
    stop();

    expect(ids).toEqual(["p-42"]);
  });
});
