import { randomUUID } from "node:crypto";
import { KeychainCredentialStore } from "./keychain-store.js";
import type {
  CredentialRef,
  CredentialStore,
  CredentialStoreName,
} from "./types.js";

const stores: Record<CredentialStoreName, CredentialStore> = {
  keychain: new KeychainCredentialStore(),
};

export function getCredentialStore(store: CredentialStoreName): CredentialStore {
  return stores[store];
}

export function getDefaultCredentialStore(): CredentialStore {
  return stores.keychain;
}

export function createCredentialRef(
  store: CredentialStoreName = "keychain"
): CredentialRef {
  return { store, id: randomUUID() };
}

export function isCredentialRef(value: unknown): value is CredentialRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CredentialRef>;
  return candidate.store === "keychain" && typeof candidate.id === "string";
}

export { CredentialStoreError } from "./errors.js";
export type { CredentialStoreErrorCode } from "./errors.js";
export type {
  CredentialRef,
  CredentialStore,
  CredentialStoreName,
} from "./types.js";
