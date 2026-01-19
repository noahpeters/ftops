declare module "node:stream" {
  export class PassThrough {
    destroy(): void;
  }

  export class Readable {
    static toWeb(stream: unknown): ReadableStream;
  }
}
