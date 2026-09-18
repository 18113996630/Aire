import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorManager } from '../../src/ios/simulator-manager.ts';

test('findOrBootDevice reuses already booted device', async () => {
  const mockExec = async (cmd: string, args: string[]) => {
    if (args.includes('list') && args.includes('devices')) {
      return JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
            {
              udid: 'BOOTED-UDID-1234',
              name: 'iPhone 16 Pro',
              state: 'Booted',
              isAvailable: true,
            },
          ],
        },
      });
    }
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  const udid = await manager.findOrBootDevice('iPhone 16 Pro');
  assert.equal(udid, 'BOOTED-UDID-1234');
});

test('findOrBootDevice boots shutdown device if none is booted', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    if (args.includes('list') && args.includes('devices')) {
      return JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
            {
              udid: 'SHUTDOWN-UDID-5678',
              name: 'iPhone 16 Pro',
              state: 'Shutdown',
              isAvailable: true,
            },
          ],
        },
      });
    }
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  const udid = await manager.findOrBootDevice('iPhone 16 Pro');
  assert.equal(udid, 'SHUTDOWN-UDID-5678');
  assert.ok(executed.some((c) => c.includes('boot SHUTDOWN-UDID-5678')));
});

test('takeScreenshot calls simctl io screenshot', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  await manager.takeScreenshot('UDID-999', '/tmp/out.png');
  assert.ok(executed.some((c) => c.includes('io UDID-999 screenshot /tmp/out.png')));
});

test('installApp calls simctl install with udid and path', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  await manager.installApp('UDID-123', '/path/to/app.app');
  assert.ok(executed.some((c) => c.includes('simctl install UDID-123 /path/to/app.app')));
});

test('launchApp parses pid from output', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    return 'com.example.app: 54321\n';
  };

  const manager = new SimulatorManager(mockExec);
  const pid = await manager.launchApp('UDID-123', 'com.example.app');
  assert.equal(pid, 54321);
  assert.ok(executed.some((c) => c.includes('simctl launch UDID-123 com.example.app')));
});

test('terminateApp calls simctl terminate and handles errors gracefully', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    if (args.includes('fail.bundle')) {
      throw new Error('Process not running');
    }
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  await manager.terminateApp('UDID-123', 'com.example.app');
  assert.ok(executed.some((c) => c.includes('simctl terminate UDID-123 com.example.app')));

  // Should not throw when terminating non-running app
  await assert.doesNotReject(async () => {
    await manager.terminateApp('UDID-123', 'fail.bundle');
  });
});

test('findOrBootDevice throws error when no devices are available', async () => {
  const mockExec = async () => JSON.stringify({ devices: {} });
  const manager = new SimulatorManager(mockExec);
  await assert.rejects(
    async () => {
      await manager.findOrBootDevice('iPhone 16 Pro');
    },
    /No available iOS simulator found matching 'iPhone 16 Pro'/
  );
});

test('listDevices filters out unavailable devices', async () => {
  const mockExec = async () =>
    JSON.stringify({
      devices: {
        runtime1: [
          { udid: 'U1', name: 'iPhone 14', state: 'Shutdown', isAvailable: false },
          { udid: 'U2', name: 'iPhone 15', state: 'Booted', isAvailable: true },
        ],
      },
    });

  const manager = new SimulatorManager(mockExec);
  const devices = await manager.listDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].udid, 'U2');
  assert.equal(devices[0].state, 'Booted');
});

test('launchApp returns 0 when output does not match pid pattern', async () => {
  const mockExec = async () => 'some random output without pid';
  const manager = new SimulatorManager(mockExec);
  const pid = await manager.launchApp('UDID-1', 'com.test');
  assert.equal(pid, 0);
});

