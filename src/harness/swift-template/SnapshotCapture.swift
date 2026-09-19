//
// SnapshotCapture.swift
// AIRE State Snapshot & Route Three-tier Inference Capture
//

import Foundation
import XCTest

public class SnapshotCapture {
    private let app: XCUIApplication

    public init(app: XCUIApplication) {
        self.app = app
    }

    public func capture(
        stepId: String,
        artifactDir: String,
        bootstrapRoute: String? = nil
    ) -> StateSnapshot {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let screenshotFilename = "\(stepId).png"
        let screenshotPath = (artifactDir as NSString).appendingPathComponent(screenshotFilename)

        // 1. Capture Native Screenshot
        let screenshot = XCUIScreen.main.screenshot()
        let pngData = screenshot.pngRepresentation
        try? pngData.write(to: URL(fileURLWithPath: screenshotPath))

        // 2. Extract Elements
        let elements = extractElements()

        // 3. Three-tier Route Inference
        let (route, confidence) = inferRoute(elements: elements, bootstrapRoute: bootstrapRoute)

        // 4. Keyboard Visibility
        let keyboardVisible = app.keyboards.count > 0

        return StateSnapshot(
            stepId: stepId,
            timestamp: timestamp,
            screenshotPath: screenshotPath,
            route: route,
            routeConfidence: confidence,
            keyboardVisible: keyboardVisible,
            activeOverlay: nil,
            elements: elements,
            error: nil
        )
    }

    private func extractElements() -> [ElementSnapshot] {
        var results: [ElementSnapshot] = []

        // Extract interactive elements
        let allElements = app.descendants(matching: .any).allElementsBoundByIndex
        for el in allElements.prefix(50) { // Bound to prevent slow tree serialization
            let identifier = el.identifier.isEmpty ? nil : el.identifier
            let label = el.label.isEmpty ? nil : el.label
            let value = el.value as? String
            let frame = FrameSnapshot(
                x: Double(el.frame.origin.x),
                y: Double(el.frame.origin.y),
                width: Double(el.frame.size.width),
                height: Double(el.frame.size.height)
            )

            results.append(
                ElementSnapshot(
                    identifier: identifier,
                    label: label,
                    elementType: "\(el.elementType)",
                    isEnabled: el.isEnabled,
                    isHittable: el.isHittable,
                    frame: frame,
                    value: value
                )
            )
        }

        return results
    }

    private func inferRoute(
        elements: [ElementSnapshot],
        bootstrapRoute: String?
    ) -> (String?, String) {
        // Tier 1: flow.screen.<name>
        for el in elements {
            if let id = el.identifier, id.hasPrefix("flow.screen.") {
                let route = String(id.dropFirst("flow.screen.".count))
                return (route, "exact_identifier")
            }
        }

        // Tier 2: Navigation title heuristic
        let navBar = app.navigationBars.firstMatch
        if navBar.exists && !navBar.identifier.isEmpty {
            return (navBar.identifier, "nav_title_inferred")
        }

        // Tier 3: Bootstrap assumed
        if let bootstrap = bootstrapRoute {
            return (bootstrap, "bootstrap_assumed")
        }

        return (nil, "bootstrap_assumed")
    }
}
