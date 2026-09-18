/**
 * AIRE Analysis IR & Evidence Model
 *
 * Single machine source-of-truth for upstream intelligence:
 * 1. RawEvidence: Physical measurements, images, OCR blocks, and PRD AST.
 * 2. VisualToken: Design tokens with strict physical evidence anchors ("No evidence, no token").
 * 3. ComponentSpec & ScreenSpec: UI hierarchy and verification probes.
 * 4. ProductFlowSpec & RequirementSpec: Business stories and acceptance criteria.
 * 5. DataEntitySpec & ArchitectureContract: MVVM/SwiftData models and file boundaries.
 * 6. AnalysisIR: Top-level unified intermediate representation.
 */

export interface PhysicalImageEvidence {
  filePath: string;
  width: number;
  height: number;
  colorSpace: 'sRGB' | 'DisplayP3';
  dominantColors: string[];
  ocrTextBlocks?: Array<{
    text: string;
    bounds?: [number, number, number, number];
  }>;
}

export interface PrdSectionEvidence {
  title: string;
  level: number;
  content: string;
  subsections: PrdSectionEvidence[];
}

export interface RawEvidence {
  images: PhysicalImageEvidence[];
  prdSections: PrdSectionEvidence[];
  collectedAt: string;
}

export type TokenCategory = 'color' | 'typography' | 'spacing' | 'radius' | 'shadow';

export interface TokenEvidence {
  sourceFile: string;
  probeBox?: [number, number, number, number]; // [x1, y1, x2, y2]
  samplingMethod: 'flat_fill' | 'ink_core' | 'hairline' | 'manual';
}

export interface VisualToken {
  id: string;
  category: TokenCategory;
  name: string;
  value: string | number;
  swiftValue: string;
  evidence: TokenEvidence;
}

export interface ProbeTolerance {
  containerDeltaMax: number;
  spacingPtMax: number;
  textDeltaMax: number;
}

export interface ComponentProbeSpec {
  id: string;
  focus: string;
  bounds: [number, number, number, number];
  tolerance: ProbeTolerance;
}

export type LayoutFlow = 'VStack' | 'HStack' | 'ZStack' | 'List' | 'ScrollView';

export interface ComponentSpec {
  id: string;
  name: string;
  role: string;
  layout: LayoutFlow;
  tokens: string[]; // references VisualToken.id
  subcomponents?: ComponentSpec[];
  probe?: ComponentProbeSpec;
}

export interface ScreenSpec {
  id: string;
  title: string;
  route: string;
  components: ComponentSpec[];
  safeArea: {
    top: boolean;
    bottom: boolean;
  };
  referenceImage?: string;
}

export interface FlowStep {
  stepNumber: number;
  screenId: string;
  action: string;
  expectedState: string;
}

export interface ProductFlowSpec {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
}

export type RequirementCategory = 'functional' | 'ui' | 'data' | 'navigation';

export interface RequirementSpec {
  id: string;
  title: string;
  category: RequirementCategory;
  acceptanceCriteria: string[];
}

export interface EntityField {
  name: string;
  type: string;
  isOptional?: boolean;
  defaultValue?: string;
}

export interface DataEntitySpec {
  name: string;
  isSwiftDataModel: boolean;
  conformance: string[];
  fields: EntityField[];
}

export interface ArchitectureLayer {
  directory: string;
  files: string[];
}

export interface ArchitectureContract {
  pattern: 'MVVM' | 'MVVM-C';
  layers: {
    models: ArchitectureLayer;
    viewModels: ArchitectureLayer;
    views: ArchitectureLayer;
    services?: ArchitectureLayer;
  };
  fileBoundaries: string[];
}

export interface AnalysisIR {
  version: string;
  appName: string;
  targetScheme: string;
  evidence: RawEvidence;
  flows: ProductFlowSpec[];
  requirements: RequirementSpec[];
  screens: ScreenSpec[];
  tokens: VisualToken[];
  entities: DataEntitySpec[];
  architecture: ArchitectureContract;
  createdAt: string;
}
