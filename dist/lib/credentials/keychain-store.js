import { Entry } from "@napi-rs/keyring";
import { CredentialStoreError } from "./errors.js";
const KEYCHAIN_SERVICE = "mongocop";
export class KeychainCredentialStore {
    name = "keychain";
    assertStore(ref) {
        if (ref.store !== this.name) {
            throw new CredentialStoreError("unsupported_store", `Unsupported credential store "${ref.store}" for keychain backend.`);
        }
    }
    async get(ref) {
        this.assertStore(ref);
        try {
            const entry = new Entry(KEYCHAIN_SERVICE, ref.id);
            const value = entry.getPassword();
            return value ?? undefined;
        }
        catch (cause) {
            throw new CredentialStoreError("backend_error", "Unable to read credential from keychain.", { cause });
        }
    }
    async set(ref, value) {
        this.assertStore(ref);
        try {
            const entry = new Entry(KEYCHAIN_SERVICE, ref.id);
            entry.setPassword(value);
        }
        catch (cause) {
            throw new CredentialStoreError("backend_error", "Unable to save credential to keychain.", { cause });
        }
    }
    async delete(ref) {
        this.assertStore(ref);
        try {
            const entry = new Entry(KEYCHAIN_SERVICE, ref.id);
            entry.deletePassword();
        }
        catch (cause) {
            throw new CredentialStoreError("backend_error", "Unable to delete credential from keychain.", { cause });
        }
    }
}
