import {
  modeProgress,
  nameFieldVisible,
  otherMode,
  resolveNameRowHeight,
  validateAuthFields,
} from "../lib/auth-form";

describe("auth-form mode logic", () => {
  it("toggles between the two modes", () => {
    expect(otherMode("signin")).toBe("signup");
    expect(otherMode("signup")).toBe("signin");
  });

  it("shows the name field only when creating an account", () => {
    expect(nameFieldVisible("signup")).toBe(true);
    expect(nameFieldVisible("signin")).toBe(false);
  });

  it("drives the reveal progress from the mode", () => {
    expect(modeProgress("signup")).toBe(1);
    expect(modeProgress("signin")).toBe(0);
  });

  it("switching from sign in to create account targets a revealed name field", () => {
    // Regression: swapping sign-in -> create account must reopen the name field.
    const next = otherMode("signin");
    expect(next).toBe("signup");
    expect(nameFieldVisible(next)).toBe(true);
    expect(modeProgress(next)).toBe(1);
  });
});

describe("resolveNameRowHeight", () => {
  const FALLBACK = 58;

  it("uses a real measurement when it is positive", () => {
    expect(resolveNameRowHeight(61, FALLBACK)).toBe(61);
  });

  it("never collapses the row to zero when measured while hidden", () => {
    // Regression: entering in sign-in mode measures the collapsed row as 0.
    // A 0 must not stick, or the name field can't reopen in create-account mode.
    expect(resolveNameRowHeight(0, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for negative or non-finite measurements", () => {
    expect(resolveNameRowHeight(-4, FALLBACK)).toBe(FALLBACK);
    expect(resolveNameRowHeight(Number.NaN, FALLBACK)).toBe(FALLBACK);
    expect(resolveNameRowHeight(Number.POSITIVE_INFINITY, FALLBACK)).toBe(FALLBACK);
  });
});

describe("validateAuthFields", () => {
  it("requires an email and a password", () => {
    const errors = validateAuthFields("signin", { email: "", password: "" });
    expect(errors.email).toBe("Enter your email.");
    expect(errors.password).toBe("Enter your password.");
  });

  it("rejects a malformed email", () => {
    const errors = validateAuthFields("signin", { email: "not-an-email", password: "secret" });
    expect(errors.email).toBe("Enter a valid email.");
  });

  it("does not enforce a minimum password length when signing in", () => {
    const errors = validateAuthFields("signin", { email: "a@b.com", password: "short" });
    expect(errors.password).toBeUndefined();
  });

  it("enforces an 8-character minimum password when creating an account", () => {
    const errors = validateAuthFields("signup", { email: "a@b.com", password: "short" });
    expect(errors.password).toBe("Password must be at least 8 characters.");
  });

  it("passes with a valid email and a long-enough password", () => {
    const errors = validateAuthFields("signup", { email: "a@b.com", password: "longenough" });
    expect(errors).toEqual({});
  });
});
