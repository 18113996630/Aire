//
// FlowModels.swift
// AIRE Flow DSL & Schema SSOT Swift Models
//
// Aligned strictly with schemas/flow-definition.schema.json
//

import Foundation

public struct FlowCoordinate: Codable, Equatable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct ActionTarget: Codable, Equatable {
    public let type: String
    public let identifier: String?
    public let coordinate: FlowCoordinate?
    public let predicate: String?

    public init(type: String, identifier: String? = nil, coordinate: FlowCoordinate? = nil, predicate: String? = nil) {
        self.type = type
        self.identifier = identifier
        self.coordinate = coordinate
        self.predicate = predicate
    }
}

public struct ElementAssertion: Codable, Equatable {
    public let target: ActionTarget
    public let enabled: Bool?
    public let textEquals: String?
    public let textContains: String?
}

public struct StateAssertion: Codable, Equatable {
    public let elementsExist: [ElementAssertion]?
    public let elementsNotExist: [ActionTarget]?
    public let keyboardVisible: Bool?
    public let expectedRoute: String?
}

public struct VisualProbeTolerance: Codable, Equatable {
    public let containerDeltaMax: Double?
    public let spacingPtMax: Double?
    public let textDeltaMax: Double?
}

public struct VisualProbesExpectation: Codable, Equatable {
    public let focusArea: String?
    public let tolerance: VisualProbeTolerance?
}

public struct StepExpectation: Codable, Equatable {
    public let checkpoint: Bool?
    public let referenceImage: String?
    public let state: StateAssertion?
    public let visualProbes: VisualProbesExpectation?
}

public struct FlowStepDefinition: Codable, Equatable {
    public let stepId: String
    public let action: String
    public let target: ActionTarget?
    public let value: String?
    public let timeoutMs: Double?
    public let allowCoordinateFallback: Bool?
    public let expect: StepExpectation?
}

public struct FlowBootstrap: Codable, Equatable {
    public let type: String
    public let value: String
    public let environment: [String: String]?
}

public struct FlowDefinition: Codable, Equatable {
    public let schemaVersion: String
    public let flowId: String
    public let name: String
    public let description: String
    public let bootstrap: FlowBootstrap?
    public let steps: [FlowStepDefinition]
}

public struct FlowStepError: Codable, Equatable {
    public let code: String
    public let message: String
    public let targetIdentifier: String?
}

public struct FlowStepReport: Codable, Equatable {
    public let stepId: String
    public let action: String
    public let success: Bool
    public let targetResolvedBy: String
    public let durationMs: Double
    public let error: FlowStepError?
    public let usedFallback: Bool?
    public let snapshotPath: String?
}

public struct FlowExecutionReport: Codable, Equatable {
    public let flowId: String
    public let success: Bool
    public let totalDurationMs: Double
    public let completedSteps: Int
    public let totalSteps: Int
    public let stepReports: [FlowStepReport]
    public let failedStepId: String?
    public let error: String?
}

public struct FrameSnapshot: Codable, Equatable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct ElementSnapshot: Codable, Equatable {
    public let identifier: String?
    public let label: String?
    public let elementType: String
    public let isEnabled: Bool
    public let isHittable: Bool
    public let frame: FrameSnapshot
    public let value: String?
}

public struct StateSnapshot: Codable, Equatable {
    public let stepId: String
    public let timestamp: String
    public let screenshotPath: String
    public let route: String?
    public let routeConfidence: String
    public let keyboardVisible: Bool
    public let activeOverlay: String?
    public let elements: [ElementSnapshot]
    public let error: String?
}
