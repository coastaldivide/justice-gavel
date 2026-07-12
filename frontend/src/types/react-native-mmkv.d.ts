declare module 'react-native-mmkv' {
  export class MMKV {
    constructor(config?: { id?: string });
    getString(key: string): string | undefined;
    set(key: string, value: string | boolean | number): void;
    delete(key: string): void;
    getAllKeys(): string[];
    getBoolean(key: string): boolean | undefined;
    getNumber(key: string): number | undefined;
  }
}
