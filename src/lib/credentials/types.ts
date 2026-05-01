export type CredentialStoreName = "keychain";

export interface CredentialRef {
  store: CredentialStoreName;
  id: string;
}

export interface CredentialStore {
  readonly name: CredentialStoreName;
  get(ref: CredentialRef): Promise<string | undefined>;
  set(ref: CredentialRef, value: string): Promise<void>;
  delete(ref: CredentialRef): Promise<void>;
}
