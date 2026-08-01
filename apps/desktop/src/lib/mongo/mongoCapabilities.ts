import type { ConnectionConfig } from "@/types/database";

type MongoConnectionProfile = Pick<ConnectionConfig, "db_type" | "driver_profile">;

/** Accept historical Legacy profile spellings while persisted configs are normalized. */
export function isMongoLegacyDriverProfile(driverProfile?: string): boolean {
  const profile = driverProfile?.trim().toLowerCase();
  return profile === "mongodb-legacy" || profile === "mongodb_legacy" || profile === "legacy";
}

/** Capabilities implemented by both the native driver and the Legacy Agent. */
export function supportsMongoAllDriverMutations(connection?: MongoConnectionProfile): boolean {
  return connection?.db_type === "mongodb";
}

/** MongoDB views do not own indexes; collections and time-series collections do. */
export function supportsMongoIndexMutations(connection?: MongoConnectionProfile, collectionKind?: string): boolean {
  return supportsMongoAllDriverMutations(connection) && collectionKind?.trim().toLowerCase() !== "view";
}

/** Capabilities which require the native Rust MongoDB driver. */
export function supportsNativeMongoDriverMutations(connection?: MongoConnectionProfile): boolean {
  return connection?.db_type === "mongodb" && !isMongoLegacyDriverProfile(connection.driver_profile);
}
