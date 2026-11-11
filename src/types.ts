export type FieldType = "text" | "secret" | "url" | "email" | "token" | "multiline";
export interface VaultField { id: string; name: string; fieldType: FieldType; value: string; sensitive: boolean; }
export interface Credential { id: string; name: string; project: string; environment: string; service: string; tags: string[]; fields: VaultField[]; updatedAt: string; }
export interface Vault { version: number; credentials: Credential[]; settings: { autoLockMinutes: number }; }
export const emptyVault = (): Vault => ({ version: 1, credentials: [], settings: { autoLockMinutes: 5 } });
