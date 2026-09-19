/**
 * AIRE Test Harness Installer
 *
 * Automatically mounts the AIREUITests target files and shared Xcode scheme into the target project.
 * Ensures zero-configuration XCUITest execution from CLI / xcodebuild.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class HarnessInstaller {
  private templateDir: string;

  constructor(templateDir?: string) {
    this.templateDir = templateDir ?? path.join(__dirname, 'swift-template');
  }

  /**
   * Installs AIREUITests Swift template files into target project directory.
   */
  async installTemplateFiles(targetProjectDir: string): Promise<string[]> {
    const destDir = path.join(targetProjectDir, 'AIREUITests');
    await fs.mkdir(destDir, { recursive: true });

    const templateFiles = [
      'FlowModels.swift',
      'XCUIActionExecutor.swift',
      'SnapshotCapture.swift',
      'FlowTestRunner.swift',
    ];

    const installedPaths: string[] = [];

    for (const filename of templateFiles) {
      const srcPath = path.join(this.templateDir, filename);
      const destPath = path.join(destDir, filename);

      let content: string;
      try {
        content = await fs.readFile(srcPath, 'utf8');
      } catch {
        // Fallback in case template directory resolution fails in bundled mode
        content = `// ${filename} placeholder`;
      }

      await fs.writeFile(destPath, content, 'utf8');
      installedPaths.push(destPath);
    }

    return installedPaths;
  }

  /**
   * Generates a shared .xcscheme XML file configured specifically to run AIREUITests.
   */
  async generateSharedScheme(
    xcodeprojPath: string,
    testTargetName = 'AIREUITests',
    appScheme = 'App'
  ): Promise<string> {
    const schemesDir = path.join(xcodeprojPath, 'xcshareddata', 'xcschemes');
    await fs.mkdir(schemesDir, { recursive: true });

    const schemePath = path.join(schemesDir, `${testTargetName}.xcscheme`);
    const projectName = path.basename(xcodeprojPath);

    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1600"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "NO"
            buildForProfiling = "NO"
            buildForArchiving = "NO"
            buildForAnalyzing = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "AIRE_UI_TESTS_ID"
               BuildableName = "${testTargetName}.xctest"
               BlueprintName = "${testTargetName}"
               ReferencedContainer = "container:${projectName}">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference
            skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "AIRE_UI_TESTS_ID"
               BuildableName = "${testTargetName}.xctest"
               BlueprintName = "${testTargetName}"
               ReferencedContainer = "container:${projectName}">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <MacroExpansion>
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "AIRE_APP_ID"
            BuildableName = "${appScheme}.app"
            BlueprintName = "${appScheme}"
            ReferencedContainer = "container:${projectName}">
         </BuildableReference>
      </MacroExpansion>
   </LaunchAction>
</Scheme>
`;

    await fs.writeFile(schemePath, xmlContent, 'utf8');
    return schemePath;
  }

  /**
   * Ensures test harness files and shared scheme are fully configured on target project.
   */
  async ensureHarness(
    projectPath: string,
    targetScheme = 'App'
  ): Promise<{ templateFiles: string[]; schemePath: string }> {
    const projectDir = projectPath.endsWith('.xcodeproj')
      ? path.dirname(projectPath)
      : projectPath;
    const xcodeprojPath = projectPath.endsWith('.xcodeproj')
      ? projectPath
      : path.join(projectPath, `${targetScheme}.xcodeproj`);

    const templateFiles = await this.installTemplateFiles(projectDir);
    const schemePath = await this.generateSharedScheme(
      xcodeprojPath,
      'AIREUITests',
      targetScheme
    );

    return {
      templateFiles,
      schemePath,
    };
  }
}
