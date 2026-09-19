//
// XCUIActionExecutor.swift
// AIRE In-Process Action Executor with Level 1 Coordinate Fallback
//

import Foundation
import XCTest

public enum ExecutionResult {
    case success(targetResolvedBy: String, usedFallback: Bool)
    case failure(error: FlowStepError, targetResolvedBy: String, usedFallback: Bool)
}

public class XCUIActionExecutor {
    private let app: XCUIApplication

    public init(app: XCUIApplication) {
        self.app = app
    }

    public func execute(step: FlowStepDefinition) -> ExecutionResult {
        switch step.action {
        case "tap":
            return executeTap(step: step)
        case "input":
            return executeInput(step: step)
        case "clear":
            return executeClear(step: step)
        case "swipe":
            return executeSwipe(step: step)
        case "wait":
            let ms = step.timeoutMs ?? 500
            Thread.sleep(forTimeInterval: ms / 1000.0)
            return .success(targetResolvedBy: "none", usedFallback: false)
        case "pressBack":
            return executePressBack()
        default:
            return .failure(
                error: FlowStepError(
                    code: "UNSUPPORTED_ACTION",
                    message: "Action '\(step.action)' is not supported",
                    targetIdentifier: step.target?.identifier
                ),
                targetResolvedBy: "none",
                usedFallback: false
            )
        }
    }

    private func executeTap(step: FlowStepDefinition) -> ExecutionResult {
        guard let target = step.target else {
            return .failure(
                error: FlowStepError(code: "MISSING_TARGET", message: "Tap requires a target", targetIdentifier: nil),
                targetResolvedBy: "none",
                usedFallback: false
            )
        }

        // Primary: Accessibility Identifier
        if target.type == "accessibility", let identifier = target.identifier {
            let element = app.descendants(matching: .any)[identifier].firstMatch
            if element.waitForExistence(timeout: 2.0) && element.isHittable {
                element.tap()
                return .success(targetResolvedBy: "accessibility", usedFallback: false)
            }

            // Fallback Level 1: In-process Coordinate Tap
            if step.allowCoordinateFallback == true, let coord = target.coordinate {
                let screenCoord = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: coord.x, dy: coord.y))
                screenCoord.tap()
                return .success(targetResolvedBy: "coordinate", usedFallback: true)
            }

            return .failure(
                error: FlowStepError(
                    code: "ELEMENT_NOT_FOUND",
                    message: "Target '\(identifier)' was not found or not hittable",
                    targetIdentifier: identifier
                ),
                targetResolvedBy: "none",
                usedFallback: false
            )
        }

        // Direct Coordinate Tap
        if target.type == "coordinate", let coord = target.coordinate {
            let screenCoord = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: coord.x, dy: coord.y))
            screenCoord.tap()
            return .success(targetResolvedBy: "coordinate", usedFallback: false)
        }

        // Predicate Target
        if target.type == "predicate", let predicateStr = target.predicate {
            let predicate = NSPredicate(format: predicateStr)
            let element = app.descendants(matching: .any).matching(predicate).firstMatch
            if element.waitForExistence(timeout: 2.0) {
                element.tap()
                return .success(targetResolvedBy: "predicate", usedFallback: false)
            }
        }

        return .failure(
            error: FlowStepError(code: "TARGET_RESOLUTION_FAILED", message: "Failed to resolve target", targetIdentifier: target.identifier),
            targetResolvedBy: "none",
            usedFallback: false
        )
    }

    private func executeInput(step: FlowStepDefinition) -> ExecutionResult {
        guard let text = step.value else {
            return .failure(
                error: FlowStepError(code: "MISSING_VALUE", message: "Input requires a string value", targetIdentifier: step.target?.identifier),
                targetResolvedBy: "none",
                usedFallback: false
            )
        }

        if let target = step.target, target.type == "accessibility", let identifier = target.identifier {
            let element = app.descendants(matching: .any)[identifier].firstMatch
            if element.waitForExistence(timeout: 2.0) {
                element.tap()
                element.typeText(text)
                return .success(targetResolvedBy: "accessibility", usedFallback: false)
            }
        }

        if let target = step.target, target.coordinate != nil {
            _ = executeTap(step: step)
            app.typeText(text)
            return .success(targetResolvedBy: "coordinate", usedFallback: true)
        }

        app.typeText(text)
        return .success(targetResolvedBy: "none", usedFallback: false)
    }

    private func executeClear(step: FlowStepDefinition) -> ExecutionResult {
        if let target = step.target, target.type == "accessibility", let identifier = target.identifier {
            let element = app.descendants(matching: .any)[identifier].firstMatch
            if element.waitForExistence(timeout: 2.0) {
                if let strVal = element.value as? String, !strVal.isEmpty {
                    let deleteString = String(repeating: XCUIKeyboardKey.delete.rawValue, count: strVal.count)
                    element.typeText(deleteString)
                }
                return .success(targetResolvedBy: "accessibility", usedFallback: false)
            }
        }
        return .success(targetResolvedBy: "none", usedFallback: false)
    }

    private func executeSwipe(step: FlowStepDefinition) -> ExecutionResult {
        app.swipeUp()
        return .success(targetResolvedBy: "none", usedFallback: false)
    }

    private func executePressBack() -> ExecutionResult {
        if app.navigationBars.buttons.firstMatch.exists {
            app.navigationBars.buttons.firstMatch.tap()
            return .success(targetResolvedBy: "accessibility", usedFallback: false)
        }
        return .success(targetResolvedBy: "none", usedFallback: false)
    }
}
