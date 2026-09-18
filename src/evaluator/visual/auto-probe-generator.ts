import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProbeRow {
  id: string;
  cmd: 'sample' | 'bbox' | 'scan' | 'hairline' | 'bands';
  box?: [number, number, number, number];
  axis?: 'row' | 'col';
  at?: number;
  range?: [number, number];
  only?: 'flat' | 'ink';
  ink?: string;
  bg?: string;
  scale?: string;
  img: string;
  mine: string;
  _?: string;
}

export class AutoProbeGenerator {
  async generateProbes(params: {
    referenceImagePath: string;
    renderedImageName: string;
    scale?: number;
    outputPath: string;
  }): Promise<string> {
    const scale = params.scale ?? 3.0;
    const ref = params.referenceImagePath;
    const mine = params.renderedImageName;

    // 确定性基准探针集
    const probes: ProbeRow[] = [
      {
        id: 'bg-fill',
        img: ref,
        mine,
        cmd: 'sample',
        box: [100, 65, 300, 105],
        only: 'flat',
        _: 'Page ground below Dynamic Island and above title ink',
      },
      {
        id: 'title-ink',
        img: ref,
        mine,
        cmd: 'sample',
        box: [20, 110, 370, 150],
        only: 'ink',
        ink: '8',
        _: 'Title text ink core (darkest 8%)',
      },
      {
        id: 'card-inset',
        img: ref,
        mine,
        cmd: 'scan',
        axis: 'row',
        at: 220,
        range: [0, 60],
        _: 'Horizontal inset scan to detect card left padding',
      },
      {
        id: 'content-band',
        img: ref,
        mine,
        cmd: 'bands',
        box: [20, 150, 370, 600],
        _: 'Main vertical ink rhythm and row pitches',
      },
    ];

    await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
    await fs.writeFile(params.outputPath, JSON.stringify(probes, null, 2), 'utf8');
    return params.outputPath;
  }
}
