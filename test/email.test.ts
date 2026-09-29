import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sendEmail", () => {
  const env = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_REPLY_TO;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("logs instead of sending when RESEND_API_KEY is unset", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "reader@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(result).toEqual({ sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("sends through the Resend API when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.app>";
    fetchMock.mockResolvedValue(json({ id: "email_123" }));
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "reader@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      tags: [{ name: "category", value: "test" }],
      idempotencyKey: "idem-1",
      replyTo: "support@ciciro.app",
    });

    expect(result).toEqual({ sent: true, id: "email_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(init.headers["Idempotency-Key"]).toBe("idem-1");
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({
      from: "Ciciro <hello@ciciro.app>",
      to: "reader@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      reply_to: "support@ciciro.app",
      tags: [{ name: "category", value: "test" }],
    });
  });

  it("maps a Resend error response without throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.app>";
    fetchMock.mockResolvedValue(json({ message: "Invalid `to` field", name: "validation_error" }, 422));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "not-an-email",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(result).toEqual({
      sent: false,
      error: { message: "Invalid `to` field", code: "validation_error" },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("throws on failure when throwOnError is set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.app>";
    fetchMock.mockResolvedValue(json({ message: "boom", name: "server_error" }, 500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");

    await expect(
      sendEmail({
        to: "reader@example.com",
        subject: "Hello",
        html: "<p>Hi</p>",
        text: "Hi",
        throwOnError: true,
      })
    ).rejects.toThrow("boom");
  });

  it("fails without sending when EMAIL_FROM is missing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "reader@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(result.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes the API key in a result", async () => {
    process.env.RESEND_API_KEY = "super-secret-key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.app>";
    fetchMock.mockResolvedValue(json({ message: "boom" }, 500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");

    const result = await sendEmail({
      to: "reader@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(JSON.stringify(result)).not.toContain("super-secret-key");
  });
});

describe("hasResendKey", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("reports false with no key and true once set", async () => {
    const { hasResendKey } = await import("@/lib/email");
    expect(hasResendKey()).toBe(false);

    process.env.RESEND_API_KEY = "re_test_key";
    vi.resetModules();
    const reloaded = await import("@/lib/email");
    expect(reloaded.hasResendKey()).toBe(true);
  });
});
