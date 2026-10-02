import { serverPushHrefFromNotificationData } from "../lib/push-notifications";

describe("serverPushHrefFromNotificationData", () => {
  it.each(["share-comment", "writing-nudge", "chat-finished", "autowrite-finished"])(
    "opens a %s push's href",
    (kind) => {
      expect(serverPushHrefFromNotificationData({ kind, href: "/manuscripts" })).toBe("/manuscripts");
    }
  );

  it("rejects an unrecognized kind", () => {
    expect(serverPushHrefFromNotificationData({ kind: "writing-reminder", href: "/manuscripts" })).toBeNull();
    expect(serverPushHrefFromNotificationData({ kind: "something-else", href: "/manuscripts" })).toBeNull();
  });

  it("rejects a missing, external, or malformed href", () => {
    expect(serverPushHrefFromNotificationData({ kind: "chat-finished" })).toBeNull();
    expect(serverPushHrefFromNotificationData({ kind: "chat-finished", href: "//evil.example" })).toBeNull();
    expect(serverPushHrefFromNotificationData({ kind: "chat-finished", href: "https://evil.example" })).toBeNull();
  });

  it("rejects non-object data", () => {
    expect(serverPushHrefFromNotificationData(null)).toBeNull();
    expect(serverPushHrefFromNotificationData("href")).toBeNull();
    expect(serverPushHrefFromNotificationData(undefined)).toBeNull();
  });
});
