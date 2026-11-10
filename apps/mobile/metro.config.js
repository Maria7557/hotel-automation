const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const packagesRoot = path.resolve(__dirname, "../../packages") + path.sep;

// Workspace packages use ESM .js imports while Expo consumes their TypeScript source.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (context.originModulePath.startsWith(packagesRoot) && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
