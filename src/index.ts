export {
  addModelToConfig,
  DEFAULT_CONFIG,
  getConfigPath,
  normalizeModelEntry,
  readConfig,
  removeModelFromConfig,
  type SubagentModelEntry,
  type SubagentModelsConfig,
  type SubagentPatchMode,
  writeConfig,
} from "./config.js";
export {
  DEFAULT_GATEWAY_URL,
  fetchGatewayModels,
  normalizeGatewayModelsUrl,
  type RawGatewayModel,
  type SyncGatewayOptions,
  type SyncGatewayResult,
  syncGatewayModels,
} from "./gateway-sync.js";
export {
  buildNativeConversionHint,
  convertNativeToNpmLocal,
  extractClaudeVersion,
  isBinaryFile,
  type LocatedCli,
  type LocateOptions,
  locateCliJs,
} from "./locator.js";
export { isNativeBinaryPatched, patchNativeBinary } from "./native-patcher.js";
export {
  type BackupMetadata,
  computeHash,
  getBackupMetaPath,
  getBackupPath,
  isPatchedContent,
  PATCH_MARKER,
  type PatchResult,
  patchCliJs,
  RUNTIME_HELPER_SNIPPET,
  restoreCliJs,
  type TransformStats,
  transformCliJsContent,
  verifySyntaxWithNode,
} from "./patcher.js";
export { type WatchHandle, watchCliJsForUpdates } from "./watcher.js";
