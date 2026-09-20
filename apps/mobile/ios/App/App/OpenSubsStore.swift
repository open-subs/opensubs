import Capacitor
import Foundation
import StoreKit

/// StoreKit 2, reduced to what the web app needs.
///
/// The rule this file exists to enforce: **a transaction is finished only
/// after the server has said the credits are in the ledger.** StoreKit
/// keeps an unfinished transaction alive across launches and re-delivers
/// it, so a purchase interrupted by a crash, a dead network or a
/// force-quit is retried on the next start. Finishing eagerly -- which is
/// what the obvious code does -- throws that safety net away, and the
/// customer is charged for credits nobody granted.
///
/// So nothing here finishes anything on its own. `finish` is a separate
/// call the page makes after the server has answered; the order lives in
/// apps/web/src/lib/iap.ts and is tested in apps/web/e2e/iap.mjs.
///
/// The account is deliberately not here. Sign-in, the access token and the
/// balance are the page's, and a Swift half that reached into them would
/// be a second implementation of the session.
@objc(OpenSubsStore)
public class OpenSubsStore: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpenSubsStore"
    public let jsName = "OpenSubsStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "outstanding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
    ]

    /// Must match `app_iap_products.product_id` on the server and the
    /// products in App Store Connect. There is no third place: the server
    /// decides what a pack is *worth*, App Store Connect decides what it
    /// *costs*, and this list only decides what to ask about.
    ///
    /// Prefixed with the app's name because the server looks a product up
    /// by `(platform, product_id)` alone -- a bare `credits_1000` is
    /// already openpdfedit's, and would be resolved to its bundle id and
    /// then fail verification against ours.
    static let productIdentifiers = [
        "opensubs_credits_1000",
        "opensubs_credits_5000",
    ]

    private var products: [Product] = []
    /// Verified transactions the server has not yet confirmed, by id.
    private var awaitingServer: [String: StoreKit.Transaction] = [:]
    private var updates: Task<Void, Never>?

    override public func load() {
        // Started at load and never cancelled while the app is alive.
        // Apple's own guidance: a transaction can arrive at any moment --
        // an Ask to Buy approved hours later, a purchase made on another
        // device, an interrupted one completing -- and one that arrives
        // with no listener is only delivered again on the next launch.
        updates = Task { [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard let self else { return }
                let receipt = await self.hold(result)
                await MainActor.run { self.notifyListeners("transaction", data: receipt) }
            }
        }
    }

    deinit { updates?.cancel() }

    @objc func products(_ call: CAPPluginCall) {
        Task {
            do {
                try await loadProducts()
                call.resolve(["products": describeProducts()])
            } catch {
                call.reject("Could not load the credit packs: \(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            return call.reject("productId is required")
        }
        Task {
            do {
                // Load on demand if nobody has yet. A purchase tapped
                // before the catalogue arrived is a race, not a mistake,
                // and answering it with "the App Store has no product
                // called opensubs_credits_1000" sends whoever reads that
                // looking in App Store Connect for a product that is there.
                if products.isEmpty { try await loadProducts() }
                guard let product = products.first(where: { $0.id == productId }) else {
                    return call.reject("The App Store has no product called \(productId).")
                }
                switch try await product.purchase() {
                case .success(let verification):
                    call.resolve(await hold(verification))
                case .userCancelled:
                    // Not an error. Someone who changed their mind has not
                    // had a problem, and showing them one is the commonest
                    // way apps get this wrong.
                    call.resolve(["status": "cancelled"])
                case .pending:
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                // StoreKit reports a cancellation two ways and only one of
                // them is `.userCancelled` above: dismissing the sheet at
                // certain moments *throws* instead. Left to propagate, that
                // shows somebody who changed their mind an error about a
                // purchase that never happened.
                if Self.isCancellation(error) {
                    call.resolve(["status": "cancelled"])
                } else {
                    call.reject("The purchase could not be completed: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Everything StoreKit still considers owing, including from previous
    /// launches. The recovery path, run at startup rather than behind a
    /// "Restore purchases" button: a customer whose purchase was
    /// interrupted should not have to know that word.
    @objc func outstanding(_ call: CAPPluginCall) {
        Task {
            var receipts: [[String: Any]] = []
            for await result in StoreKit.Transaction.unfinished {
                receipts.append(await hold(result))
            }
            call.resolve(["receipts": receipts])
        }
    }

    /// Marks a transaction done, after the server has granted its credits.
    ///
    /// Unknown ids are ignored rather than refused: the page may replay a
    /// confirmation for a transaction already finished on a previous
    /// launch, and that is a duplicate, not a fault.
    @objc func finish(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId") else {
            return call.reject("transactionId is required")
        }
        Task {
            if let transaction = await removeAwaiting(transactionId) {
                await transaction.finish()
            }
            call.resolve(["finished": true])
        }
    }

    // MARK: - the parts worth testing on their own

    /// Whether an error thrown by `purchase()` means "they changed their
    /// mind" rather than "something went wrong".
    ///
    /// Static and separate so it can be tested: neither shape can be
    /// produced on demand from a test session, and the mapping is the part
    /// that matters.
    static func isCancellation(_ error: Error) -> Bool {
        if let storeKit = error as? StoreKitError, case .userCancelled = storeKit {
            return true
        }
        if let purchase = error as? Product.PurchaseError, case .productUnavailable = purchase {
            return false
        }
        let nsError = error as NSError
        return nsError.domain == SKErrorDomain
            && nsError.code == SKError.Code.paymentCancelled.rawValue
    }

    // MARK: - internals

    private func loadProducts() async throws {
        products = try await Product.products(for: Self.productIdentifiers)
            .sorted { $0.price < $1.price }
    }

    /// What the page is told about a product.
    ///
    /// `displayPrice` is StoreKit's, already in the customer's currency and
    /// written the way their region writes money. Formatting a price
    /// ourselves is a reliable way to show ¥500 as $500.
    private func describeProducts() -> [[String: Any]] {
        products.map { product in
            [
                "id": product.id,
                "name": product.displayName,
                "description": product.description,
                "price": product.displayPrice,
            ]
        }
    }

    /// Keep the transaction until the server has spoken, and describe it
    /// for the page.
    private func hold(_ result: VerificationResult<StoreKit.Transaction>) async -> [String: Any] {
        let transaction: StoreKit.Transaction
        let verified: Bool
        switch result {
        case .verified(let value):
            transaction = value
            verified = true
        case .unverified(let value, _):
            transaction = value
            verified = false
        }
        let id = String(transaction.id)
        await addAwaiting(id, transaction)
        return [
            "status": "purchased",
            "transactionId": id,
            "productId": transaction.productID,
            // The signed transaction, exactly as the server verifies it.
            "receipt": result.jwsRepresentation,
            // Reported, never acted on: the server verifies Apple's
            // signature itself and is the only authority that matters. A
            // device with a wrong clock fails here and verifies perfectly
            // there, and throwing away a receipt the customer paid for
            // because of that would be our bug, not their problem.
            "verifiedLocally": verified,
        ]
    }

    @MainActor private func addAwaiting(_ id: String, _ transaction: StoreKit.Transaction) {
        awaitingServer[id] = transaction
    }

    @MainActor private func removeAwaiting(_ id: String) -> StoreKit.Transaction? {
        awaitingServer.removeValue(forKey: id)
    }
}
