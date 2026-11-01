module.exports = ({ config }) => {
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();
  const plugins = [...(config.plugins ?? [])];

  // Google native sign-in requires the reversed iOS OAuth client ID during prebuild.
  // Keeping this conditional lets the web app run before production OAuth credentials exist.
  if (iosUrlScheme) {
    plugins.push([
      "react-native-nitro-google-signin",
      { iosUrlScheme },
    ]);
  }

  return {
    ...config,
    plugins,
  };
};
