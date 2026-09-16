const fs = require('fs');
const path = require('path');

const {
  IOSConfig,
  withAppDelegate,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const SCENE_DELEGATE_FILENAME = 'SceneDelegate.swift';
const SCENE_DELEGATE_SOURCE = path.join(__dirname, 'scene-delegate.swift');

// Marker left in AppDelegate.swift so the mod is idempotent across repeated prebuilds.
const APP_DELEGATE_MARKER = 'started by `SceneDelegate`';

/**
 * The window creation and React Native startup that Expo's SDK 57 AppDelegate template does inline.
 * `SceneDelegate` takes both over, because under the scene life cycle the window has to come from
 * the connecting scene.
 */
const APP_DELEGATE_STARTUP_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n[ \t]*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

const APP_DELEGATE_REPLACEMENT = `
    // The window is created and React Native is ${APP_DELEGATE_MARKER}, which the scene-based
    // life cycle requires — see plugins/with-ios-scene-lifecycle.js.
`;

/**
 * Declares the scene-based life cycle. UIKit does not accept the manifest on its own: it keeps
 * trapping unless `UISceneConfigurations` names a delegate class that conforms to `UISceneDelegate`.
 */
const withSceneManifest = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

const withSceneDelegateFile = (config) =>
  withXcodeProject(config, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const destination = path.join(IOSConfig.Paths.getSourceRoot(config.modRequest.projectRoot), SCENE_DELEGATE_FILENAME);

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(SCENE_DELEGATE_SOURCE, destination);

    const relativePath = `${projectName}/${SCENE_DELEGATE_FILENAME}`;
    const alreadyLinked = Object.values(config.modResults.hash.project.objects.PBXBuildFile ?? {}).some(
      (buildFile) => typeof buildFile?.fileRef_comment === 'string' && buildFile.fileRef_comment === SCENE_DELEGATE_FILENAME
    );

    if (!alreadyLinked) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relativePath,
        groupName: projectName,
        project: config.modResults,
      });
    }

    return config;
  });

const withSceneAwareAppDelegate = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.contents.includes(APP_DELEGATE_MARKER)) {
      return config;
    }

    if (!APP_DELEGATE_STARTUP_BLOCK.test(config.modResults.contents)) {
      throw new Error(
        'with-ios-scene-lifecycle: could not find the window/startReactNative block in AppDelegate.swift. ' +
          'Expo probably changed the template — re-read plugins/scene-delegate.swift and update this mod, ' +
          'or drop the plugin if the SDK now adopts the scene life cycle itself.'
      );
    }

    config.modResults.contents = config.modResults.contents.replace(
      APP_DELEGATE_STARTUP_BLOCK,
      APP_DELEGATE_REPLACEMENT
    );
    return config;
  });

/**
 * Adopts the UIScene life cycle on iOS.
 *
 * Apps built against the iOS 27 SDK crash on launch without it: UIKit traps in
 * `__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` while creating the first scene.
 * iOS 26 and earlier only logged the same issue, so the app still launches there.
 *
 * Expo adopts the scene life cycle itself from SDK 58 on. Once this project is on SDK 58, delete
 * this plugin and `plugins/scene-delegate.swift` — the generated template covers both.
 */
module.exports = (config) => {
  config = withSceneManifest(config);
  config = withSceneDelegateFile(config);
  config = withSceneAwareAppDelegate(config);
  return config;
};
