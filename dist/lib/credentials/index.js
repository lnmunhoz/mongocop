import { randomUUID } from "node:crypto";
import { KeychainCredentialStore } from "./keychain-store.js";
const stores = {
    keychain: new KeychainCredentialStore(),
};
export function getCredentialStore(store) {
    return stores[store];
}
export function getDefaultCredentialStore() {
    return stores.keychain;
}
export function createCredentialRef(store = "keychain") {
    return { store, id: randomUUID() };
}
export function isCredentialRef(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.store === "keychain" && typeof candidate.id === "string";
}
export { CredentialStoreError } from "./errors.js";
