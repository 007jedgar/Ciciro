import React
import UIKit

/**
 Hosts React Native under the scene-based life cycle, which the iOS 27 SDK requires: UIKit traps in
 `__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` while creating the first scene of
 an app that is built against that SDK and still uses the app-based life cycle. With a debugger
 attached Xcode reports it as a runtime issue; with no debugger the trap kills the app on launch.

 Expo ships this as `ExpoAppSceneDelegate` from SDK 58 on. This project is on SDK 57, which has no
 scene support at any patch version, so the class is backported here. Two jobs:
 - create the `UIWindow` from the connecting scene and start React Native into it, and
 - re-feed the URL, user-activity, life-cycle, and quick-action events that UIKit now delivers here
   instead of to the app delegate, so `AppDelegate`'s overrides — and through them every Expo
   module subscriber — still see them.
 */
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    guard let appDelegate, let factory = appDelegate.reactNativeFactory else {
      fatalError(
        "SceneDelegate couldn't start React Native because AppDelegate hadn't created its "
        + "RCTReactNativeFactory yet. It is expected to do that in "
        + "application(_:didFinishLaunchingWithOptions:), which UIKit calls before this."
      )
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window

    // Mirror the window onto the app delegate so code reading `UIApplication.shared.delegate?.window`
    // keeps working (expo-system-ui does this).
    appDelegate.window = window

    // Under the scene life cycle UIKit hands cold-start URLs and activities to us in
    // `connectionOptions` rather than to the app delegate in its launch options. React Native's
    // `Linking.getInitialURL()` only reads them from launch options, so rebuild them here —
    // otherwise a link that cold-starts the app reaches no one, because the `url` event routed
    // below fires before JS is ready to hear it.
    let browsingWebActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: Self.launchOptions(
        url: connectionOptions.urlContexts.first?.url,
        userActivity: browsingWebActivity
      )
    )

    // Deep links and universal links.
    connectionOptions.urlContexts.forEach {
      open(url: $0.url, options: Self.openURLOptions(from: $0.options))
    }
    connectionOptions.userActivities.forEach { self.continueUserActivity($0) }

    // A quick action that cold-starts the app arrives here instead of through
    // `windowScene(_:performActionFor:completionHandler:)`, which UIKit only calls while running.
    if let shortcutItem = connectionOptions.shortcutItem {
      appDelegate.application(UIApplication.shared, performActionFor: shortcutItem) { _ in }
    }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  // MARK: - Life-cycle events

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  // MARK: - URLs and user activities

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { open(url: $0.url, options: Self.openURLOptions(from: $0.options)) }
  }

  func scene(_ scene: UIScene, willContinueUserActivityWithType userActivityType: String) {
    // The scene callback has no return value, unlike its app-delegate counterpart. Calling the app
    // delegate still lets every subscriber prepare; its aggregated result is intentionally ignored.
    _ = appDelegate?.application(
      UIApplication.shared,
      willContinueUserActivityWithType: userActivityType
    )
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    continueUserActivity(userActivity)
  }

  func scene(
    _ scene: UIScene,
    didFailToContinueUserActivityWithType userActivityType: String,
    error: Error
  ) {
    appDelegate?.application(
      UIApplication.shared,
      didFailToContinueUserActivityWithType: userActivityType,
      error: error
    )
  }

  func scene(_ scene: UIScene, didUpdate userActivity: NSUserActivity) {
    appDelegate?.application(UIApplication.shared, didUpdate: userActivity)
  }

  // MARK: - Quick actions

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let appDelegate else {
      completionHandler(false)
      return
    }
    appDelegate.application(
      UIApplication.shared,
      performActionFor: shortcutItem,
      completionHandler: completionHandler
    )
  }

  // MARK: - Forwarding

  /// `AppDelegate` hands URLs to `RCTLinkingManager` itself, so forwarding to it is enough — calling
  /// `RCTLinkingManager` again here would deliver the JS `url` event twice.
  private func open(url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) {
    _ = appDelegate?.application(UIApplication.shared, open: url, options: options)
  }

  /// Named apart from the `scene(_:continue:)` callback so the two don't collide.
  private func continueUserActivity(_ userActivity: NSUserActivity) {
    _ = appDelegate?.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

// MARK: - Launch options

extension SceneDelegate {
  /// Rebuilds the launch options that `Linking.getInitialURL()` reads from a scene's connection
  /// options. Returns `nil` when the app wasn't cold-started by a URL or a browsing-web activity,
  /// so it can be forwarded to `startReactNative` as-is.
  static func launchOptions(
    url: URL?,
    userActivity: NSUserActivity?
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    // Build the keys from their underlying constant strings rather than the `UIApplication`
    // accessors (`.url`, `.userActivityDictionary`): those accessors are deprecated as of iOS 26 in
    // favor of the scene APIs, but React Native's `getInitialURL` still reads the launch options by
    // these exact keys, so this is the shape it expects.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url {
      let urlKey = UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")
      launchOptions[urlKey] = url
    }
    if let userActivity {
      let userActivityDictionaryKey = UIApplication.LaunchOptionsKey(
        rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey"
      )
      launchOptions[userActivityDictionaryKey] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
    }
    return launchOptions.isEmpty ? nil : launchOptions
  }

  static func openURLOptions(
    from sceneOptions: UIScene.OpenURLOptions
  ) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = sceneOptions.annotation {
      options[.annotation] = annotation
    }
    options[.openInPlace] = sceneOptions.openInPlace
    return options
  }
}
