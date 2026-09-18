import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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

export interface GenerateProbesParams {
  referenceImagePath: string;
  renderedImageName: string;
  scale?: number;
  outputPath: string;
  focusAreas?: string[];
}

export class AutoProbeGenerator {
  buildProbeList(params: GenerateProbesParams): ProbeRow[] {
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

    if (params.focusAreas && params.focusAreas.length > 0) {
      for (const area of params.focusAreas) {
        const lower = area.toLowerCase().trim();
        if (lower.includes('nav') || lower.includes('header')) {
          probes.push({
            id: `${lower}-fill`,
            img: ref,
            mine,
            cmd: 'sample',
            box: [0, 44, 393, 98],
            only: 'flat',
            _: `Navigation/Header region sample for ${area}`,
          });
        } else if (lower.includes('button') || lower.includes('cta')) {
          probes.push({
            id: `${lower}-bbox`,
            img: ref,
            mine,
            cmd: 'bbox',
            box: [20, 700, 373, 760],
            _: `Button bounding box for ${area}`,
          });
        } else if (lower.includes('tab') || lower.includes('footer')) {
          probes.push({
            id: `${lower}-fill`,
            img: ref,
            mine,
            cmd: 'sample',
            box: [0, 780, 393, 852],
            only: 'flat',
            _: `Tab bar / footer region sample for ${area}`,
          });
        }
      }
    }

    return probes;
  }

  async generateProbes(params: GenerateProbesParams): Promise<string> {
    const probes = this.buildProbeList(params);

    try {
      await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
      await fs.writeFile(params.outputPath, JSON.stringify(probes, null, 2), 'utf8');
      return params.outputPath;
    } catch (err: any) {
      // 容错：测试环境或不可写虚拟路径下回退至系统临时目录
      if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOENT') {
        const fallbackDir = path.join(os.tmpdir(), `aire-probes-${Date.now()}`);
        await fs.mkdir(fallbackDir, { recursive: true });
        const fallbackPath = path.join(fallbackDir, path.basename(params.outputPath));
        await fs.writeFile(fallbackPath, JSON.stringify(probes, null, 2), 'utf8');
        return fallbackPath;
      }
      throw err;
    }
  }
}
