declare module '@sabaki/gtp' {
  export interface GtpResponse {
    error: string | null;
    content: string;
  }
  export interface GtpCommand {
    name: string;
    args?: string[];
  }
  export class Controller {
    constructor(path: string, args?: string[], spawnOptions?: Record<string, unknown>);
    process: import('child_process').ChildProcess | null;
    get busy(): boolean;
    get commands(): GtpCommand[];
    start(): void;
    stop(timeout?: number): Promise<void>;
    kill(): Promise<void>;
    sendCommand(command: GtpCommand, subscriber?: () => void): Promise<GtpResponse>;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }
}

declare module '@sabaki/sgf' {
  export interface SgfNode {
    id?: number;
    data: Record<string, string[]>;
    parentId?: number | null;
    children?: SgfNode[];
  }
  export function stringify(nodes: SgfNode[], options?: Record<string, unknown>): string;
  export function parse(contents: string, options?: Record<string, unknown>): SgfNode[];
  export function parseVertex(input: string): [number, number];
  export function stringifyVertex(vertex: [number, number]): string;
}
