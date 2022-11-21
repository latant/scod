export type SameKeys<A, B> = {
  [K in keyof A]: K extends keyof B ? B[K] : never;
} & B;