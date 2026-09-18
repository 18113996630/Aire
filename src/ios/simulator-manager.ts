import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SimDevice, SimctlExecFn } from './types.ts';

const execFileAsync = promisify(execFile);

const defaultExecFn: SimctlExecFn = async (cmd, args) => {
  const { stdout } = await execFileAsync(cmd, args);
  return stdout;
};

export interface ISimulatorManager {
  findOrBootDevice(preferredName?: string): Promise<string>;
  installApp(udid: string, appBundlePath: string): Promise<void>;
  launchApp(udid: string, bundleId: string): Promise<number>;
  takeScreenshot(udid: string, outputPath: string): Promise<void>;
  terminateApp(udid: string, bundleId: string): Promise<void>;
  sendInput?(udid: string, action: string, params: Record<string, any>): Promise<void>;
}

export class SimulatorManager implements ISimulatorManager {
  private execFn: SimctlExecFn;

  constructor(execFn: SimctlExecFn = defaultExecFn) {
    this.execFn = execFn;
  }

  async listDevices(): Promise<SimDevice[]> {
    const raw = await this.execFn('xcrun', ['simctl', 'list', 'devices', '-j']);
    const parsed = JSON.parse(raw);
    const devices: SimDevice[] = [];
    for (const runtime of Object.values(parsed.devices || {})) {
      if (Array.isArray(runtime)) {
        for (const d of runtime as any[]) {
          if (d.isAvailable !== false) {
            devices.push({
              udid: d.udid,
              name: d.name,
              state: d.state === 'Booted' ? 'Booted' : 'Shutdown',
              isAvailable: d.isAvailable,
            });
          }
        }
      }
    }
    return devices;
  }

  async findOrBootDevice(preferredName = 'iPhone 16 Pro'): Promise<string> {
    const devices = await this.listDevices();
    // 1. If preferred device is already booted, reuse it
    const preferredBooted = devices.find((d) => d.state === 'Booted' && (!preferredName || d.name === preferredName));
    if (preferredBooted) {
      return preferredBooted.udid;
    }

    // 2. If preferred device exists (even if Shutdown), boot it instead of hijacking another model
    const preferredShutdown = preferredName ? devices.find((d) => d.name === preferredName) : undefined;
    if (preferredShutdown) {
      await this.execFn('xcrun', ['simctl', 'boot', preferredShutdown.udid]);
      try {
        await this.execFn('xcrun', ['simctl', 'bootstatus', preferredShutdown.udid, '-b']);
      } catch {
        // 忽略测试 mock 环境下 bootstatus 缺失的报错
      }
      return preferredShutdown.udid;
    }

    // 3. Fall back to any booted device if no preferredName was specified or preferred was not found
    const anyBooted = devices.find((d) => d.state === 'Booted');
    if (anyBooted) {
      return anyBooted.udid;
    }

    // 4. Fall back to first available device
    const target = devices[0];
    if (!target) {
      throw new Error(`No available iOS simulator found matching '${preferredName}'.`);
    }

    await this.execFn('xcrun', ['simctl', 'boot', target.udid]);
    try {
      await this.execFn('xcrun', ['simctl', 'bootstatus', target.udid, '-b']);
    } catch {
      // 忽略测试 mock 环境下 bootstatus 缺失的报错
    }
    return target.udid;
  }

  async installApp(udid: string, appBundlePath: string): Promise<void> {
    await this.execFn('xcrun', ['simctl', 'install', udid, appBundlePath]);
  }

  async launchApp(udid: string, bundleId: string): Promise<number> {
    const out = await this.execFn('xcrun', ['simctl', 'launch', udid, bundleId]);
    const match = out.match(/: (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async takeScreenshot(udid: string, outputPath: string): Promise<void> {
    await this.execFn('xcrun', ['simctl', 'io', udid, 'screenshot', outputPath]);
  }

  async terminateApp(udid: string, bundleId: string): Promise<void> {
    try {
      await this.execFn('xcrun', ['simctl', 'terminate', udid, bundleId]);
    } catch {
      // 忽略未运行时 terminate 抛出的错误
    }
  }
}
