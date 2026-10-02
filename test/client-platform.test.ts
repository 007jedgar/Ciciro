import { describe, expect, it } from "vitest";
import {
  CLIENT_PLATFORM_HEADER,
  clientPlatform,
  NATIVE_CLIENT_HEADER,
  NATIVE_CLIENT_VALUE,
} from "@/lib/auth/constants";

function request(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe("clientPlatform", () => {
  it("reads a browser request as web, whatever platform it claims", () => {
    expect(clientPlatform(request({}))).toBe("web");
    expect(clientPlatform(request({ [CLIENT_PLATFORM_HEADER]: "android" }))).toBe("web");
  });

  it("tells the Android app from the iOS app", () => {
    const native = { [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE };
    expect(clientPlatform(request({ ...native, [CLIENT_PLATFORM_HEADER]: "android" }))).toBe("android");
    expect(clientPlatform(request({ ...native, [CLIENT_PLATFORM_HEADER]: "ios" }))).toBe("ios");
  });

  it("reads a native build that predates the platform header as iOS", () => {
    expect(clientPlatform(request({ [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE }))).toBe("ios");
  });
});
