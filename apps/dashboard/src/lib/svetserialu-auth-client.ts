import { requestRuntimeJson } from "./local-api";

export type SvetSerialuLoginInput = {
  username?: string;
  password?: string;
};

export async function verifySvetSerialuLogin(input: SvetSerialuLoginInput) {
  const response = await requestRuntimeJson<{ ok?: boolean; error?: string }>("/api/svetserialu/auth/verify", {
    method: "POST",
    body: {
      svetserialuCredentials: input,
    },
  });

  if (!response.ok || !response.data?.ok) {
    throw new Error(response.data?.error ?? "SvetSerialu login failed.");
  }

  return true;
}
