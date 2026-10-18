// Pins the launcher name on both platforms to the brand, regardless of what any build pipeline
// writes into expo.name. Android: strings.xml app_name. iOS: CFBundleDisplayName.
const { withStringsXml, withInfoPlist, AndroidConfig } = require("@expo/config-plugins");

const APP_NAME = "TheLookCraft";

module.exports = function withAppName(config) {
  config = withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: "app_name", translatable: "false" }, _: APP_NAME }],
      c.modResults
    );
    return c;
  });
  config = withInfoPlist(config, (c) => {
    c.modResults.CFBundleDisplayName = APP_NAME;
    c.modResults.CFBundleName = APP_NAME;
    return c;
  });
  return config;
};
