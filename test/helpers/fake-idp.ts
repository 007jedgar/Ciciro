import {
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import type { SocialProvider } from "@/lib/auth/social-config";

// A stand-in for Apple's and Google's signing keys: tokens minted here verify
// against `keys` exactly as real ones verify against the provider's JWKS.

export const ISSUER: Record<SocialProvider, string> = {
  apple: "https://appleid.apple.com",
  google: "https://accounts.google.com",
};

export type FakeIdp = {
  keys: JWTVerifyGetKey;
  mint: (claims: Record<string, unknown>, options?: { expiresIn?: number; issuedAt?: number }) => Promise<string>;
};

export async function fakeIdp(provider: SocialProvider, kid = `${provider}-test-key`): Promise<FakeIdp> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  return {
    keys,
    mint: async (claims, options = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const iat = options.issuedAt ?? now;
      return new SignJWT({ iss: ISSUER[provider], ...claims })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuedAt(iat)
        .setExpirationTime(iat + (options.expiresIn ?? 600))
        .sign(privateKey);
    },
  };
}

/** A self-generated Apple .p8 equivalent (PKCS#8 PEM, P-256) and its public half. */
export async function fakeAppleSigningKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  return { pem: await exportPKCS8(privateKey), publicKey };
}
