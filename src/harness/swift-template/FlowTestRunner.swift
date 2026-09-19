//
// FlowTestRunner.swift
// AIRE Universal Flow Test Runner
//
// Reads TEST_RUNNER_FLOW_FILE_PATH, TEST_RUNNER_ARTIFACT_DIR, TEST_RUNNER_START_STEP_ID
// Executes steps, captures state snapshots, and writes flow-report.json
//

import Foundation
import XCTest

class FlowTestRunner: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testRunFlow() throws {
        let env = ProcessInfo.processInfo.environment
        guard let flowFilePath = env["TEST_RUNNER_FLOW_FILE_PATH"],
              let artifactDir = env["TEST_RUNNER_ARTIFACT_DIR"] else {
            XCTFail("Missing TEST_RUNNER_FLOW_FILE_PATH or TEST_RUNNER_ARTIFACT_DIR")
            return
        }

        let startStepId = env["TEST_RUNNER_START_STEP_ID"]

        // 1. Read Flow Definition
        let flowURL = URL(fileURLWithPath: flowFilePath)
        let flowData = try Data(contentsOf: flowURL)
        let flow = try JSONDecoder().decode(FlowDefinition.self, from: flowData)

        // 2. Configure Bootstrap Launch Arguments
        if let bootstrap = flow.bootstrap {
            if bootstrap.type == "launchArgs" {
                let args = bootstrap.value.components(separatedBy: " ").filter { !$0.isEmpty }
                app.launchArguments.append(contentsOf: args)
            }
            if let customEnv = bootstrap.environment {
                for (k, v) in customEnv {
                    app.launchEnvironment[k] = v
                }
            }
        }

        app.launch()

        let executor = XCUIActionExecutor(app: app)
        let capture = SnapshotCapture(app: app)

        var stepReports: [FlowStepReport] = []
        var completedSteps = 0
        var failedStepId: String? = nil
        var globalError: String? = nil
        var skipping = startStepId != nil

        let startTime = Date()

        for step in flow.steps {
            if skipping {
                if step.stepId == startStepId {
                    skipping = false
                } else {
                    continue
                }
            }

            let stepStartTime = Date()
            let result = executor.execute(step: step)
            let stepDuration = Date().timeIntervalSince(stepStartTime) * 1000.0

            var snapshotPath: String? = nil
            if step.expect?.checkpoint == true {
                let snapshot = capture.capture(
                    stepId: step.stepId,
                    artifactDir: artifactDir,
                    bootstrapRoute: flow.bootstrap?.value
                )
                snapshotPath = snapshot.screenshotPath

                // Also save snapshot JSON
                let snapshotJSONPath = (artifactDir as NSString).appendingPathComponent("\(step.stepId)-snapshot.json")
                if let jsonData = try? JSONEncoder().encode(snapshot) {
                    try? jsonData.write(to: URL(fileURLWithPath: snapshotJSONPath))
                }
            }

            switch result {
            case .success(let targetResolvedBy, let usedFallback):
                completedSteps += 1
                stepReports.append(
                    FlowStepReport(
                        stepId: step.stepId,
                        action: step.action,
                        success: true,
                        targetResolvedBy: targetResolvedBy,
                        durationMs: stepDuration,
                        error: nil,
                        usedFallback: usedFallback,
                        snapshotPath: snapshotPath
                    )
                )

            case .failure(let error, let targetResolvedBy, let usedFallback):
                failedStepId = step.stepId
                globalError = error.message
                stepReports.append(
                    FlowStepReport(
                        stepId: step.stepId,
                        action: step.action,
                        success: false,
                        targetResolvedBy: targetResolvedBy,
                        durationMs: stepDuration,
                        error: error,
                        usedFallback: usedFallback,
                        snapshotPath: snapshotPath
                    )
                )
                break
            }

            if failedStepId != nil {
                break
            }
        }

        let totalDuration = Date().timeIntervalSince(startTime) * 1000.0
        let report = FlowExecutionReport(
            flowId: flow.flowId,
            success: failedStepId == nil,
            totalDurationMs: totalDuration,
            completedSteps: completedSteps,
            totalSteps: flow.steps.count,
            stepReports: stepReports,
            failedStepId: failedStepId,
            error: globalError
        )

        // Write flow-report.json
        let reportPath = (artifactDir as NSString).appendingPathComponent("flow-report.json")
        let reportData = try JSONEncoder().encode(report)
        try reportData.write(to: URL(fileURLWithPath: reportPath))

        if let failure = failedStepId {
            XCTFail("Flow failed at step \(failure): \(globalError ?? "")")
        }
    }
}
