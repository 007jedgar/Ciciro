import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every route that leaves by the pop transition must be presented over the
// stack, or going back plays the collapse against a blank screen.
describe("project stack layout", () => {
  const source = readFileSync(join(__dirname, "../app/project/[id]/_layout.tsx"), "utf8");
  const routes = readdirRoutes();

  function readdirRoutes(): string[] {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(join(__dirname, "../app/project/[id]"))
      .filter((f) => f !== "_layout.tsx" && f !== "(tabs)")
      .map((f) => f.replace(/\.tsx$/, ""));
  }

  it.each(routes)("presents %s over the stack", (route) => {
    expect(source).toMatch(new RegExp(`name="${route.replace(/[[\]]/g, "\\$&")}(/\\[chapterId\\])?"[^>]*CONTAINED_POP_OVER`));
  });
});
