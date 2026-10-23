/** A migration must not silently prefer one configured key source over another. */
export function assertMigrationKeyringSource(env: NodeJS.ProcessEnv = process.env): void {
  if (env.TOKEN_ENCRYPTION_KEYRING_JSON?.trim() &&
      [env.TOKEN_ENCRYPTION_KEY, env.TOKEN_ENCRYPTION_KEY_NEXT, env.TOKEN_ENCRYPTION_KEY_PREVIOUS]
        .some(value => value?.trim())) {
    throw new Error("MIGRATION_KEY_SOURCE_CONFLICT");
  }
}
