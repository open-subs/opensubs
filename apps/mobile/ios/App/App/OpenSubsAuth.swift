import AuthenticationServices
import Capacitor
import UIKit
import WebKit

/// Google sign-in, carried out the one way iOS allows, and brought back.
///
/// `<openapps-login>` signs in with Google by sending the whole page to the
/// accounts server, with `return_to` set to the page's own address. In a
/// browser that is a round trip. In this shell it was a one-way trip:
///
///   1. The page navigates to `https://auth.opensubs.app/v1/auth/oidc/google/start`.
///   2. Capacitor allows a top-level navigation only to the app's own origin.
///      Anything else it hands to `UIApplication.open` -- the default
///      browser -- and cancels in the web view.
///   3. The sign-in succeeds in that browser, and the server redirects it to
///      `return_to`, which is `capacitor://localhost/#code=...`.
///   4. No app registers the `capacitor` scheme, so the browser has nowhere to
///      send it. Safari shows an error, Edge "The application couldn't be
///      opened", and the one-time code never reaches the app.
///
/// This plugin takes step 2 instead. It recognises the start of a redirect
/// sign-in and opens it in `ASWebAuthenticationSession`, which is Apple's
/// sheet for exactly this. Google accepts it where it refuses an embedded
/// web view. It shows the real address bar and shares Safari's cookies. And
/// it catches the redirect to `capacitor://` itself, whatever the default
/// browser is and whether or not any app claims the scheme. The callback URL
/// is then put in the web view's address and the page reloaded, which is
/// the page arriving back at `return_to` exactly as it would in a browser. `<openapps-login>`
/// exchanges the code on load as it always has.
///
/// Nothing on the server changes. `capacitor://localhost` was already an
/// allowed `return_to` origin, and every redirect provider, and linking a
/// provider to an existing account, goes through the same two paths.
@objc(OpenSubsAuth)
public class OpenSubsAuth: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "OpenSubsAuth"
    public let jsName = "OpenSubsAuth"
    public let pluginMethods: [CAPPluginMethod] = []

    /// The accounts server, as the page knows it (apps/web/src/lib/account.ts).
    static let authHost = "auth.opensubs.app"

    /// The scheme the page is served from, and so the scheme `return_to`
    /// carries. The session watches for it and closes when it comes back.
    static let callbackScheme = "capacitor"

    /// Held for the life of the sheet: releasing it dismisses it.
    private var session: ASWebAuthenticationSession?

    /// Whether a navigation is the first step of a redirect sign-in:
    /// `/v1/auth/oidc/<provider>/start` to sign in, or
    /// `/v1/auth/oidc/<provider>/go` to link a provider to the account.
    ///
    /// Pure and `static` so that the one decision here, what leaves the
    /// web view, can be tested without a web view.
    static func isRedirectSignIn(_ url: URL) -> Bool {
        guard url.scheme == "https", url.host == authHost else { return false }
        let parts = url.path.split(separator: "/")
        return parts.count == 5
            && parts[0] == "v1" && parts[1] == "auth" && parts[2] == "oidc"
            && (parts[4] == "start" || parts[4] == "go")
    }

    /// Asked by Capacitor before every navigation, ahead of its own rule
    /// that sends foreign URLs to the default browser. `true` cancels the
    /// navigation in the web view. `nil` leaves the decision to Capacitor.
    @objc override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, Self.isRedirectSignIn(url) else { return nil }
        DispatchQueue.main.async { self.signIn(at: url) }
        return true
    }

    private func signIn(at url: URL) {
        // A second tap while the sheet is up would start a second flow and
        // strand the first one's challenge. The sheet is modal anyway.
        guard session == nil else { return }
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: Self.callbackScheme
        ) { [weak self] callback, error in
            DispatchQueue.main.async {
                self?.session = nil
                // Cancelling is not an error. The page is still where it was.
                guard let callback, error == nil, callback.host == "localhost" else { return }
                self?.arrive(at: callback)
            }
        }
        session.presentationContextProvider = self
        // Shared with Safari, so someone already signed in to Google on this
        // phone usually needs only one tap. The price is the system's "wants
        // to use ... to sign in" prompt before the sheet opens.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() {
            self.session = nil
        }
    }

    /// Bring the page back to `return_to`, code and all, and reload it.
    ///
    /// Not `webView.load(callback)`. The callback is usually the page's own
    /// address plus a fragment, and WebKit treats a load that differs only
    /// by fragment as a scroll within the page: the URL changes and nothing
    /// reloads, so `<openapps-login>`, which redeems the code when it
    /// connects, never sees it. Replacing the address and then reloading
    /// is what a browser arriving from the server does.
    private func arrive(at callback: URL) {
        guard let literal = try? JSONEncoder().encode(callback.absoluteString),
              let quoted = String(data: literal, encoding: .utf8)
        else { return }
        // A different path is a real navigation and loads by itself; a
        // reload straight after it would cancel it and reload the old page.
        // Only a fragment-only change needs the reload, and that change is
        // made synchronously, so the reload sees the new address.
        bridge?.webView?.evaluateJavaScript("""
            (function (to) {
              var a = new URL(to), b = new URL(location.href);
              a.hash = ""; b.hash = "";
              location.replace(to);
              if (a.href === b.href) location.reload();
            })(\(quoted));
            """)
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
