import appConfig, { releaseEnvProblems } from "../app.config";

const base = { name: "Ciciro", slug: "ciciro" };

describe("app config release guard", () => {
  it("leaves development alone", () => {
    expect(releaseEnvProblems({ EXPO_PUBLIC_API_URL: "http://localhost:3000" })).toEqual([]);
    expect(releaseEnvProblems({})).toEqual([]);
  });

  it("accepts a release pointed at the hosted app", () => {
    expect(releaseEnvProblems({ CICIRO_RELEASE: "1", EXPO_PUBLIC_API_URL: "https://ciciro.app" })).toEqual([]);
  });

  it.each([
    [{}, /not set/],
    [{ EXPO_PUBLIC_API_URL: "ciciro.app" }, /not a URL/],
    [{ EXPO_PUBLIC_API_URL: "http://ciciro.app" }, /https/],
    [{ EXPO_PUBLIC_API_URL: "https://localhost:3000" }, /local machine/],
    [{ EXPO_PUBLIC_API_URL: "https://192.168.1.4:3000" }, /local machine/],
    [{ EXPO_PUBLIC_API_URL: "https://ciciro.app", EXPO_PUBLIC_BILLING_PREVIEW: "1" }, /development-only/],
  ])("refuses a release with %j", (env, problem) => {
    expect(releaseEnvProblems({ CICIRO_RELEASE: "1", ...env }).join("\n")).toMatch(problem);
  });

  it("fails the config, not the app, when a release env is incomplete", () => {
    const saved = { ...process.env };
    try {
      process.env.CICIRO_RELEASE = "1";
      delete process.env.EXPO_PUBLIC_API_URL;
      expect(() => appConfig({ config: base } as never)).toThrow(/docs\/mobile-release\.md/);
      process.env.EXPO_PUBLIC_API_URL = "https://ciciro.app";
      expect(appConfig({ config: base } as never)).toEqual(base);
      process.env.GOOGLE_SERVICES_JSON = "/eas/google-services.json";
      expect(appConfig({ config: { ...base, android: { package: "app.ciciro.mobile" } } } as never)).toMatchObject({
        android: { package: "app.ciciro.mobile", googleServicesFile: "/eas/google-services.json" },
      });
    } finally {
      process.env = saved;
    }
  });
});
