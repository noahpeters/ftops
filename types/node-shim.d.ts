declare const __dirname: string;
declare const require: (path: string) => any;
declare const process: { cwd: () => string; env: Record<string, string | undefined> };
declare const Buffer: {
  from: (...args: unknown[]) => Uint8Array;
  alloc: (...args: unknown[]) => Uint8Array;
};

declare module "node:fs" {
  export const readFileSync: (...args: unknown[]) => string;
  export const readdirSync: (...args: unknown[]) => string[];
  const fsDefault: { readFileSync: typeof readFileSync; readdirSync: typeof readdirSync };
  export default fsDefault;
}

declare module "fs" {
  export const readFileSync: (...args: unknown[]) => string;
  export const readdirSync: (...args: unknown[]) => string[];
  export const existsSync: (...args: unknown[]) => boolean;
  export const mkdirSync: (...args: unknown[]) => void;
  export const writeFileSync: (...args: unknown[]) => void;
  const fsDefault: {
    readFileSync: typeof readFileSync;
    readdirSync: typeof readdirSync;
    existsSync: typeof existsSync;
    mkdirSync: typeof mkdirSync;
    writeFileSync: typeof writeFileSync;
  };
  export default fsDefault;
}

declare module "node:path" {
  export const join: (...args: unknown[]) => string;
  export const resolve: (...args: unknown[]) => string;
  const pathDefault: { join: typeof join; resolve: typeof resolve };
  export default pathDefault;
}

declare module "path" {
  export const join: (...args: unknown[]) => string;
  export const resolve: (...args: unknown[]) => string;
  const pathDefault: { join: typeof join; resolve: typeof resolve };
  export default pathDefault;
}

declare module "node:net" {
  export const createServer: (...args: unknown[]) => {
    once: (event: string, cb: (...args: unknown[]) => void) => void;
    listen: (port: number, host: string, cb: () => void) => void;
    close: (cb: () => void) => void;
  };
  const netDefault: unknown;
  export default netDefault;
}

declare module "node:crypto" {
  export const createHmac: (...args: unknown[]) => {
    update: (...args: unknown[]) => { digest: (...args: unknown[]) => string };
  };
  const cryptoDefault: unknown;
  export default cryptoDefault;
}
