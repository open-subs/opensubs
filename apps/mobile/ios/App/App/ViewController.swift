import Capacitor
import UIKit

/// The bridge view controller, subclassed for one reason: to register the
/// StoreKit plugin.
///
/// Capacitor 7 does not find plugins by scanning the binary. It registers
/// what `capacitor.config.json` lists in `packageClassList`, and the CLI
/// writes that list from the *npm packages* it finds -- so a plugin that
/// lives in the app target rather than in a package is compiled, linked,
/// and never registered. It fails silently and completely: the class is
/// there, `Capacitor.isPluginAvailable("OpenSubsStore")` is false, and the
/// page sees a shell with no way to buy anything.
///
/// Measured before this file existed, from the page inside the running
/// app: `pluginNames` came back as the four built-ins plus Filesystem, and
/// nothing else.
///
/// `registerPluginInstance` is the supported hook for exactly this, and
/// unlike `registerPluginType` it is not disabled when auto-registration
/// is on.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OpenSubsStore())
    }
}
