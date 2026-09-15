import {
  classifyChatFailure,
  failureFromError,
  failureMessageKey,
  splitErrorFooter,
} from "../lib/chat-errors";
import { ApiError } from "../lib/api/client";

const AUTH_FOOTER =
  '401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}';

describe("classifyChatFailure", () => {
  it("reads the provider's own error type out of an embedded payload", () => {
    const failure = classifyChatFailure(AUTH_FOOTER);
    expect(failure.code).toBe("auth");
    expect(failure.status).toBe(401);
    expect(failure.detail).toBe("API key is invalid.");
    // A rejected key is a server problem; retrying only re-runs the rejection.
    expect(failure.retryable).toBe(false);
  });

  it("marks transient provider failures retryable", () => {
    expect(
      classifyChatFailure('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
    ).toMatchObject({ code: "overloaded", retryable: true });
    expect(
      classifyChatFailure('429 {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}')
    ).toMatchObject({ code: "rateLimit", retryable: true });
  });

  it("falls back to the status when the payload is truncated mid-stream", () => {
    expect(classifyChatFailure('503 {"type":"error","err')).toMatchObject({
      code: "upstream",
      status: 503,
      retryable: true,
    });
  });

  it("classifies bare transport failures with no status at all", () => {
    expect(classifyChatFailure("Network request failed")).toMatchObject({
      code: "network",
      status: null,
      retryable: true,
    });
    expect(classifyChatFailure("")).toMatchObject({ code: "unknown" });
  });

  it("keys a translatable sentence per failure kind", () => {
    expect(failureMessageKey(classifyChatFailure(AUTH_FOOTER))).toBe("ciciroTab.failure.auth");
  });
});

describe("splitErrorFooter", () => {
  it("lifts the footer off the reply so the prose renders on its own", () => {
    const { body, failure } = splitErrorFooter(`She opened the door.\n\n[Ciciro error: ${AUTH_FOOTER}]`);
    expect(body).toBe("She opened the door.");
    expect(failure?.code).toBe("auth");
  });

  it("leaves a clean reply untouched", () => {
    expect(splitErrorFooter("All done.")).toEqual({ body: "All done.", failure: null });
  });

  it("does not mistake prose that merely mentions an error for a footer", () => {
    const { failure } = splitErrorFooter("He read the [Ciciro error: log] and then went to bed.");
    expect(failure).toBeNull();
  });
});

describe("failureFromError", () => {
  it("uses an ApiError's status when the body carries no provider payload", () => {
    expect(failureFromError(new ApiError("Editor run is already executing", 409))).toMatchObject({
      status: 409,
      code: "unknown",
    });
    expect(failureFromError(new ApiError("Too many requests", 429))).toMatchObject({
      code: "rateLimit",
      retryable: true,
    });
  });

  it("reads a provider payload carried on the ApiError body", () => {
    const error = new ApiError("An error has occurred.", 500, {
      error: '401 {"type":"error","error":{"type":"authentication_error","message":"bad key"}}',
    });
    expect(failureFromError(error)).toMatchObject({ code: "auth", retryable: false });
  });

  it("treats an aborted turn as cancelled rather than failed", () => {
    const abort = Object.assign(new Error("Aborted"), { name: "AbortError" });
    expect(failureFromError(abort)).toMatchObject({ code: "cancelled", retryable: false });
  });
});
