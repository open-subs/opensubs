// The Mac App Store build's native services: StoreKit 2 for credits, and
// Apple's own sign-in sheet.
//
// Compiled only into the store build: build.rs runs swiftc on this file when
// the `appstore` Cargo feature is on, and links the result into the app.
// The direct-download build sells credits through the card checkout in the
// browser and never contains StoreKit; a Mac App Store app may sell them only
// through StoreKit (App Review Guideline 3.1.1), and must offer Sign in with
// Apple beside Google (4.8).
//
// Two C entry points, called from src/store.rs:
//
//   opensubs_store_start(onTransaction)
//       Once, at launch. Listens for transactions that arrive on their own
//       (an interrupted purchase completing, Ask to Buy approved later) and
//       hands each to `onTransaction` as JSON.
//   opensubs_store_call(id, op, argJSON, reply)
//       One request from the page, answered later through
//       `reply(id, json, ok)`. `op` is one of products, purchase, outstanding,
//       finish, signInWithApple.
//
// The answers are the iOS shell's shapes (apps/mobile/ios/App/App/
// OpenSubsStore.swift), so the page redeems a Mac purchase exactly as it
// redeems an iPhone one: apps/web/src/lib/iap.ts. The rule that file enforces
// holds here too: a transaction is finished only after the server has said
// the credits are in the ledger, so nothing below finishes one on its own.

import AppKit
import AuthenticationServices
import Foundation
import StoreKit

public typealias StoreReply = @convention(c) (UInt64, UnsafePointer<CChar>?, Bool) -> Void
public typealias StoreEvent = @convention(c) (UnsafePointer<CChar>?) -> Void

/// Must match `app_iap_products.product_id` on the server and the products
/// in App Store Connect: the iOS app's two packs, on the same app record.
private let productIdentifiers = ["opensubs_credits_1000", "opensubs_credits_5000"]

private struct Failure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private func json(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
}

@_cdecl("opensubs_store_start")
public func opensubs_store_start(_ onTransaction: StoreEvent) {
    Store.shared.start { receipt in
        json(receipt).withCString { onTransaction($0) }
    }
}

@_cdecl("opensubs_store_call")
public func opensubs_store_call(_ id: UInt64, _ op: UnsafePointer<CChar>, _ arg: UnsafePointer<CChar>,
                                _ reply: StoreReply) {
    let op = String(cString: op)
    let body = (try? JSONSerialization.jsonObject(with: Data(String(cString: arg).utf8))) as? [String: Any] ?? [:]
    Task {
        do {
            let answer = try await answer(op, body)
            json(answer).withCString { reply(id, $0, true) }
        } catch {
            json(["message": error.localizedDescription]).withCString { reply(id, $0, false) }
        }
    }
}

private func answer(_ op: String, _ body: [String: Any]) async throws -> Any {
    switch op {
    case "products":
        return ["products": try await Store.shared.products()]
    case "purchase":
        guard let id = body["productId"] as? String else { throw Failure("productId is required") }
        return try await Store.shared.purchase(id)
    case "outstanding":
        return ["receipts": await Store.shared.outstanding()]
    case "finish":
        guard let id = body["transactionId"] as? String else { throw Failure("transactionId is required") }
        return await Store.shared.finish(id)
    case "signInWithApple":
        guard let nonce = body["nonce"] as? String, !nonce.isEmpty else {
            throw Failure("a nonce from the server's challenge is required")
        }
        return try await AppleSheet.shared.signIn(nonce: nonce)
    default:
        throw Failure("unknown request \(op)")
    }
}

// ---------------------------------------------------------------- StoreKit

/// StoreKit 2, reduced to what the page needs.
final class Store: @unchecked Sendable {
    static let shared = Store()
    private let model = Model()
    private var updates: Task<Void, Never>?

    /// The catalogue, and verified transactions the server has not yet
    /// confirmed, by id.
    private actor Model {
        var products: [Product] = []
        var awaitingServer: [String: StoreKit.Transaction] = [:]

        func load() async throws -> [Product] {
            if products.isEmpty {
                products = try await Product.products(for: productIdentifiers).sorted { $0.price < $1.price }
            }
            return products
        }

        func hold(_ result: VerificationResult<StoreKit.Transaction>) -> [String: Any] {
            let transaction: StoreKit.Transaction
            let verified: Bool
            switch result {
            case .verified(let t): transaction = t; verified = true
            case .unverified(let t, _): transaction = t; verified = false
            }
            let id = String(transaction.id)
            awaitingServer[id] = transaction
            return [
                "status": "purchased", "transactionId": id, "productId": transaction.productID,
                // The signed transaction, exactly as the server verifies it.
                "receipt": result.jwsRepresentation,
                // Reported, never acted on: a Mac with a wrong clock fails this
                // locally and verifies perfectly on the server.
                "verifiedLocally": verified,
            ]
        }

        func take(_ id: String) -> StoreKit.Transaction? { awaitingServer.removeValue(forKey: id) }
    }

    /// Listen for transactions that arrive on their own. Once, at launch: one
    /// that arrives with no listener is delivered again only on the next one.
    func start(_ onReceipt: @escaping @Sendable ([String: Any]) -> Void) {
        guard updates == nil else { return }
        updates = Task.detached { [model] in
            for await result in StoreKit.Transaction.updates {
                onReceipt(await model.hold(result))
            }
        }
    }

    /// `[{id, name, description, price}]`; the price is StoreKit's, already in
    /// the customer's currency and written the way their region writes money.
    func products() async throws -> [[String: Any]] {
        try await model.load().map {
            ["id": $0.id, "name": $0.displayName, "description": $0.description, "price": $0.displayPrice]
        }
    }

    /// `{status: "purchased", ...}`, `{status: "cancelled"}` or `{status: "pending"}`.
    func purchase(_ productId: String) async throws -> [String: Any] {
        // A purchase pressed before the catalogue arrived is a race, not a
        // mistake: load on demand rather than report a missing product.
        guard let product = try await model.load().first(where: { $0.id == productId }) else {
            throw Failure("The App Store has no product called \(productId).")
        }
        do {
            switch try await product.purchase() {
            case .success(let verification): return await model.hold(verification)
            case .userCancelled: return ["status": "cancelled"]
            case .pending: return ["status": "pending"]
            @unknown default: return ["status": "cancelled"]
            }
        } catch {
            // StoreKit reports a cancellation two ways, and only one of them is
            // `.userCancelled` above. Somebody who changed their mind has not
            // had a problem, and must not be shown one.
            if let e = error as? StoreKitError, case .userCancelled = e { return ["status": "cancelled"] }
            let ns = error as NSError
            if ns.domain == SKErrorDomain && ns.code == SKError.Code.paymentCancelled.rawValue {
                return ["status": "cancelled"]
            }
            throw error
        }
    }

    /// Everything StoreKit still considers owing, from this launch or an
    /// earlier one: the recovery path, run by the page at startup.
    func outstanding() async -> [[String: Any]] {
        var receipts: [[String: Any]] = []
        for await result in StoreKit.Transaction.unfinished {
            receipts.append(await model.hold(result))
        }
        return receipts
    }

    /// Done, after the server has granted the credits. An unknown id is a
    /// replayed confirmation, not a fault.
    func finish(_ transactionId: String) async -> [String: Any] {
        guard let t = await model.take(transactionId) else { return ["finished": false] }
        await t.finish()
        return ["finished": true]
    }
}

// ---------------------------------------------------------------- Sign in with Apple

/// Apple's own sign-in sheet. No name or email is asked for: the account
/// needs neither.
@MainActor
final class AppleSheet: NSObject, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    static let shared = AppleSheet()
    private var pending: CheckedContinuation<[String: Any], Error>?
    private var controller: ASAuthorizationController?

    /// `{status: "signed-in", identityToken, authorizationCode}`, or
    /// `{status: "cancelled"}` when the sheet is closed, which is not an error.
    func signIn(nonce: String) async throws -> [String: Any] {
        guard pending == nil else { throw Failure("a sign-in is already in progress") }
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = []
        request.nonce = nonce
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<[String: Any], Error>) {
        let p = pending
        pending = nil
        controller = nil
        p?.resume(with: result)
    }

    nonisolated func authorizationController(controller: ASAuthorizationController,
                                             didCompleteWithAuthorization authorization: ASAuthorization) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let token = credential?.identityToken.map { String(decoding: $0, as: UTF8.self) }
        let code = credential?.authorizationCode.map { String(decoding: $0, as: UTF8.self) }
        MainActor.assumeIsolated {
            guard let token else { return finish(.failure(Failure("Apple returned no identity token"))) }
            var result: [String: Any] = ["status": "signed-in", "identityToken": token]
            if let code { result["authorizationCode"] = code }
            finish(.success(result))
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        let message = error.localizedDescription
        MainActor.assumeIsolated {
            finish(cancelled ? .success(["status": "cancelled"]) : .failure(Failure(message)))
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    }
}
