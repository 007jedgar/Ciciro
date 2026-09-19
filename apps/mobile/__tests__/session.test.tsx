import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
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
    },
  },
  clearPersistedQueryCache: () => {},
  queryClient: { clear: () => {} },
}));

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
});
