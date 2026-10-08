import { consumeAuthArrival, markAuthArrival } from "../lib/auth-arrival";

describe("auth arrival", () => {
  it("is false until auth hands off", () => {
    expect(consumeAuthArrival()).toBe(false);
  });

  it("is read once by the list that mounts after a hand-off", () => {
    markAuthArrival();
    expect(consumeAuthArrival()).toBe(true);
    expect(consumeAuthArrival()).toBe(false);
  });
});
