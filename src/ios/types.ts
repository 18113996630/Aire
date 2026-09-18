export interface SimDevice {
  udid: string;
  name: string;
  state: 'Booted' | 'Shutdown' | 'Unknown';
  isAvailable?: boolean;
}

export type SimctlExecFn = (cmd: string, args: string[]) => Promise<string>;
