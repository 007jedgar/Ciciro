import { Pressable, Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SessionProvider, useSession } from "../lib/session";
import { useSession as useSessionFromLeaf } from "../lib/session-context";

jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  ciciro: {
    auth: {
      me: async () => ({ user: null }),
      login: async () => ({ user: { id: "u1", email: "a@b.c", name: "A" }, token: "t" }),
      signup: async () => ({ user: { id: "u1", email: "a@b.c", name: "A" }, token: "t" }),
      logout: async () => {},
      deleteAccount: jest.fn(async () => ({ ok: true })),
    },
  },
  clearPersistedQueryCache: () => {},
  queryClient: { clear: () => {} },
}));

jest.mock("../lib/account-data", () => ({ forgetAccountOnDevice: jest.fn(async () => {}) }));

function Probe() {
  const { ready } = useSession();
  return <Text>{ready ? "ready" : "loading"}</Text>;
}

function LeafProbe() {
  const { ready } = useSessionFromLeaf();
  return <Text>{ready ? "ready" : "loading"}</Text>;
}

describe("session context", () => {
  it("lets a screen read the provider through the session module", async () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>
    );
    expect(await screen.findByText(/ready|loading/)).toBeTruthy();
  });

  it("lets a screen read the same provider through the leaf module", async () => {
    render(
      <SessionProvider>
        <LeafProbe />
      </SessionProvider>
    );
    expect(await screen.findByText(/ready|loading/)).toBeTruthy();
  });

  it("deletes the account, then signs out and forgets it on this phone", async () => {
    const { ciciro } = jest.requireMock("../lib/api") as {
      ciciro: { auth: { deleteAccount: jest.Mock } };
    };
    const { forgetAccountOnDevice } = jest.requireMock("../lib/account-data") as {
      forgetAccountOnDevice: jest.Mock;
    };
    function Deleter() {
      const { user, login, deleteAccount } = useSession();
      return (
        <>
          <Text>{user ? `in:${user.id}` : "out"}</Text>
          <Pressable accessibilityRole="button" onPress={() => void login("a@b.c", "pw")}>
            <Text>login</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void deleteAccount({ password: "pw" })}>
            <Text>delete</Text>
          </Pressable>
        </>
      );
    }
    render(
      <SessionProvider>
        <Deleter />
      </SessionProvider>
    );
    // Let the provider's first /me refresh land before signing in.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => fireEvent.press(screen.getByText("login")));
    expect(await screen.findByText("in:u1")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText("delete")));
    expect(ciciro.auth.deleteAccount).toHaveBeenCalledWith({ password: "pw" });
    expect(await screen.findByText("out")).toBeTruthy();
    expect(forgetAccountOnDevice).toHaveBeenCalledWith("u1");
  });
});
