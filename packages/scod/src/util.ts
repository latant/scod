import { z } from "zod";

export type Val<T> = T[keyof T];

export type OrEmpty<D> = D extends {} ? D : {};

export type OrZodVoid<D> = D extends z.ZodType ? D : z.ZodVoid;

export type SameKeys<A, B> = {
  [K in keyof A]: K extends keyof B ? B[K] : never;
} & B;

export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;
