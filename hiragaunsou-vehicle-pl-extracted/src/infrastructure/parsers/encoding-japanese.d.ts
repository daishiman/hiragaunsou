declare module "encoding-japanese" {
  const Encoding: {
    convert(
      data: number[] | Uint8Array,
      options: { to: string; from: string },
    ): number[];
    codeToString(data: number[]): string;
  };
  export default Encoding;
}
