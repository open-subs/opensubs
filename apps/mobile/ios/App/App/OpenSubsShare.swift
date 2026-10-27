import Capacitor
import UIKit

/// Saving an export, the way an iPhone saves things: the share sheet.
///
/// The page saves a subtitle file or a burned video the way a browser
/// does, with an `<a download>` pointing at a blob URL. WKWebView has no
/// download manager of its own and Capacitor does not add one, so inside
/// this shell that click went nowhere -- no file, no sheet, no error.
///
/// The bytes come across the bridge as base64, in chunks, into a file in
/// the app's temporary directory; the share sheet is then opened on that
/// file. From there "Save to Files" works for every export, and a video
/// also gets "Save Video", which puts it in the photo library (hence
/// NSPhotoLibraryAddUsageDescription in Info.plist -- without it, choosing
/// that row terminates the app).
///
/// Chunked because the bridge is JSON: a burned video is easily a few
/// hundred megabytes, and one string of that as base64 is more memory than
/// a phone will give a web view. The page sends 1.5 MiB at a time.
@objc(OpenSubsShare)
public class OpenSubsShare: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpenSubsShare"
    public let jsName = "OpenSubsShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    /// One folder for every export, emptied whenever a new one starts, so
    /// at most one export's bytes are ever left behind.
    static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
    }

    /// The name the file is shared under -- it is the name it gets in
    /// Files -- with anything that would make it a path taken out.
    static func safeName(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
        return cleaned.isEmpty ? "export" : String(cleaned.prefix(200))
    }

    /// `{ name, data, append }`: base64 `data` is written to the export
    /// file, replacing it unless `append` is true.
    @objc func write(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let base64 = call.getString("data") else {
            call.reject("write needs a name and data")
            return
        }
        guard let bytes = Data(base64Encoded: base64) else {
            call.reject("write: data is not base64")
            return
        }
        let url = Self.folder.appendingPathComponent(Self.safeName(name))
        do {
            if call.getBool("append") ?? false {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: bytes)
            } else {
                try? FileManager.default.removeItem(at: Self.folder)
                try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                try bytes.write(to: url)
            }
            call.resolve()
        } catch {
            call.reject("write failed: \(error.localizedDescription)")
        }
    }

    /// `{ name }`: opens the share sheet on the file `write` produced.
    /// Resolves when the sheet closes, with whether something was done and
    /// what (`com.apple.DocumentManagerUICore.SaveToFiles`,
    /// `com.apple.UIKit.activity.SaveToCameraRoll`, ...). Closing the sheet
    /// is not an error.
    @objc func share(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("share needs a name")
            return
        }
        let url = Self.folder.appendingPathComponent(Self.safeName(name))
        guard FileManager.default.fileExists(atPath: url.path) else {
            call.reject("share: nothing was written under that name")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("share: no view to present from")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { activity, completed, _, error in
                if let error = error {
                    call.reject("share failed: \(error.localizedDescription)")
                } else {
                    call.resolve(["completed": completed, "activity": activity?.rawValue ?? ""])
                }
            }
            // On iPad the sheet is a popover and must be anchored, or UIKit
            // raises. The bottom centre of the web view is near the buttons.
            if let popover = sheet.popoverPresentationController, let view = self.bridge?.webView {
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 80, width: 1, height: 1)
                popover.permittedArrowDirections = [.down, .up]
            }
            presenter.present(sheet, animated: true)
        }
    }
}
