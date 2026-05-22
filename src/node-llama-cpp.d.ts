declare module 'node-llama-cpp' {
  export function getLlama(): Promise<any>;
  export function resolveModelFile(
    uriOrPath: string,
    options?: {
      cli?: boolean;
      download?: 'auto' | false;
      verify?: boolean;
    } | string
  ): Promise<string>;
}
