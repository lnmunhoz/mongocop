import { Entry } from "@napi-rs/keyring";
import { CredentialStoreError } from "./errors.js";
import type { CredentialRef, CredentialStore } from "./types.js";

const KEYCHAIN_SERVICE = "mongocop";

export class KeychainCredentialStore implements CredentialStore {
  readonly name = "keychain" as const;

  private assertStore(ref: CredentialRef): void {
    if (ref.store !== this.name) {
      throw new CredentialStoreError(
        "unsupported_store",
        `Unsupported credential store "${ref.store}" for keychain backend.`
      );
    }
  }

  async get(ref: CredentialRef): Promise<string | undefined> {
    this.assertStore(ref);
    try {
      const entry = new Entry(KEYCHAIN_SERVICE, ref.id);
      const value = entry.getPassword();
      return value ?? undefined;
    } catch (cause) {
      throw new CredentialStoreError(
        "backend_error",
        "Unable to read credential from keychain.",
        { cause }
      );
    }
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    this.assertStore(ref);
    try {
      const entry = new Entry(KEYCHAIN_SERVICE, ref.id);
      entry.setPassword(value);
    } catch (cause) {
      throw new CredentialStoreError(
        "backend_error",
        "Unable to save credential to keychain.",
        { cause }
      );
    }
  }

  async delete(ref: CredentialRef): Promise<void> {
    this.assertStore(ref);
    try {
      const entry = new Entry(KEYCHAIN_SERVICE, ref.id);
      entry.deletePassword();
    } catch (cause) {
      throw new CredentialStoreError(
        "backend_error",
        "Unable to delete credential from keychain.",
        { cause }
      );
    }
  }
}
