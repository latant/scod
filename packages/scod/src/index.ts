import { z } from "zod";

// https://www.npmjs.com/package/json-schema-faker
// https://www.npmjs.com/package/zod-to-json-schema
// https://www.npmjs.com/package/yargs

type Val<T> = T[keyof T];
type OrEmpty<D> = D extends {} ? D : {};
type OrZodVoid<D> = D extends z.ZodType ? D : z.ZodVoid;
type AnyDeps<D extends Deps> = keyof (D & { 0: 0 }) extends 0 ? undefined : D;

type Module<
  T = any,
  N extends string = any,
  D extends Deps = any,
  C extends Conf = any
> = {
  name: N;
  deps: D;
  conf: C;
  create: Factory<T, D, C>;
  resolve: ResolveModule<T, N, D, C>;
};

type Deps = { [key: string]: Module };

type Conf = Record<string, z.ZodType>;

type Factory<T = any, D extends Deps = any, C extends Conf = any> = (
  deps: Satisfied<D>,
  conf: ConfigValue<C>
) => Promise<T> | T;

type ResolveModule<
  T,
  N extends string = any,
  D extends Deps = any,
  C extends Conf = any
> = (config: ConfigMap<N, D, C>, ctx?: Context) => Promise<T>;

type DepsConfig<D extends Deps> = D extends AnyDeps<D>
  ? Parameters<Val<D>["resolve"]>[0]
  : {};

type ConfigMap<N extends string, D extends Deps, C extends Conf> = {
  [K in N]: ConfigValue<C>;
} & DepsConfig<D>;

type Satisfied<D extends Deps> = {
  [M in Val<D> as M["name"]]: Awaited<ReturnType<M["create"]>>;
} & (D extends AnyDeps<D> ? Parameters<Val<D>["create"]>[0] : {});

type ConfigValue<C extends Conf> = { [K in keyof C]: z.infer<C[K]> };

type ModuleOpts<N extends String> = {
  name: N;
  deps?: Deps;
  conf?: Conf;
};

type Func<
  D extends Deps = any,
  I extends Input = any,
  O extends Output = any
> = {
  deps: D;
  input: I;
  output: O;
  handle: Handler<D, I, O>;
  resolve: ResolveHandler<D, I, O>;
};

type Input = Record<string, z.ZodType>;
type Output = z.ZodType;
type InputValue<I extends Input> = { [K in keyof I]: z.infer<I[K]> };
type OutputValue<O extends Output> = z.infer<O>;

type Handler<
  D extends Deps = any,
  I extends Input = any,
  O extends Output = any
> = (
  deps: Satisfied<D>,
  input: InputValue<I>
) => Promise<z.infer<O>> | z.infer<O>;

type ResolveHandler<D extends Deps, I extends Input, O extends Output> = (
  conf: DepsConfig<D>,
  ctx?: Context
) => Promise<(input: InputValue<I>) => Promise<OutputValue<O>>>;

type FuncOpts = {
  deps?: Deps;
  input?: Input;
  output?: Output;
};

type FuncMap = { [key: string]: Func };

type FuncsConfig<M extends FuncMap> = Parameters<Val<M>["resolve"]>[0];

type CallableFuncMap<M extends FuncMap> = {
  [K in keyof M]: Awaited<ReturnType<M[K]["resolve"]>>;
};

type Funcs<M extends FuncMap> = {
  functions: M;
  resolve: (conf: FuncsConfig<M>, ctx?: Context) => Promise<CallableFuncMap<M>>;
  lazy: (conf: Partial<FuncsConfig<M>>, ctx?: Context) => CallableFuncMap<M>;
};

class Context {
  private readonly resolved: { [key: string]: unknown } = {};
  async resolve<T>(
    module: Module<T>,
    conf: Record<string, unknown>
  ): Promise<T> {
    if (!this.resolved[module.name]) {
      const satisfied: Deps = {};
      for (const k in module.deps) {
        satisfied[k] = await this.resolve(module.deps[k], conf);
      }
      const confType = z.object({ [module.name]: module.conf });
      const config = confType.parse(conf)[module.name];
      this.resolved[module.name] = await module.create(satisfied, config);
    }
    return this.resolved[module.name] as T;
  }
}

function module<
  T,
  N extends string,
  O extends ModuleOpts<N>,
  M extends Module<T, O["name"], OrEmpty<O["deps"]>, OrEmpty<O["conf"]>>
>(opts: O, create: M["create"]): M {
  const result = {
    name: opts.name,
    deps: opts.deps ?? {},
    conf: opts.conf ?? {},
    create,
  } as Module;
  const resolve: M["resolve"] = (conf, ctx) =>
    (ctx ?? new Context()).resolve(result, conf);
  return { ...result, resolve } as M;
}

function func<
  O extends FuncOpts,
  F extends Func<
    OrEmpty<O["deps"]>,
    OrEmpty<O["input"]>,
    OrZodVoid<O["output"]>
  >
>(opts: O, handle: F["handle"]): F {
  const result = {
    deps: opts.deps ?? {},
    input: opts.input ?? {},
    output: opts.output ?? z.void(),
    handle,
  } as F;
  const resolve: F["resolve"] = async (conf, ctx) => {
    const context = ctx ?? new Context();
    const inputType = z.object(result.input);
    const outputType = result.output;
    const deps: Record<string, unknown> = {};
    for (const k in result.deps) {
      deps[k] = await context.resolve((opts.deps ?? {})[k], conf);
    }
    return async (input) => {
      const output = await result.handle(
        deps as any,
        inputType.parse(input) as any
      );
      return outputType.parse(output);
    };
  };
  return { ...result, resolve };
}

function funcs<M extends FuncMap>(functions: M): Funcs<M> {
  const configMap: Record<string, z.ZodType> = {};
  for (const k in functions) {
    for (const m in functions[k].deps) {
      configMap[m] = z.strictObject(functions[k].deps[m].conf);
    }
  }
  return {
    functions,
    resolve: async (conf, ctx) => {
      const context = ctx ?? new Context();
      const config = z.object(configMap).parse(conf);
      const result: Record<string, unknown> = {};
      for (const k in functions) {
        result[k] = await functions[k].resolve(config, context);
      }
      return result as any;
    },
    lazy: (conf, ctx) => {
      const context = ctx ?? new Context();
      const config = z.object(configMap).partial().parse(conf);
      const result: Record<string, unknown> = {};
      for (const k in functions) {
        result[k] = async (input: any) => {
          const f = await functions[k].resolve(config, context);
          const output = await f(input);
          return output;
        };
      }
      return result as any;
    },
  };
}

const a = module(
  { name: "a", conf: { confA: z.string() } },
  async (deps, conf) => (conf.confA === "9" ? 9 : 0)
);

a.resolve({
  a: { confA: "" },
});

const b = module(
  { name: "b", deps: { a }, conf: { confB: z.string() } },
  async (deps) => deps.a % 2 === 0
);

b.resolve({
  a: { confA: "" },
  b: { confB: "" },
});

const c = module(
  { name: "c", deps: { b }, conf: { confC: z.string() } },
  async (deps) => deps.b + ""
);

c.resolve({
  a: { confA: "" },
  b: { confB: "" },
  c: { confC: "" },
});

const d = module(
  { name: "d", deps: { b, c } },
  async (deps, conf) => new Date()
);

d.resolve({
  a: { confA: "" },
  b: { confB: "" },
  c: { confC: "" },
  d: { asd: 123 }, /// !!!
});

const dCreated = d.create(
  {
    b: true,
    c: "",
    a: 9,
  },
  {}
);

const f = func(
  {
    deps: { a },
    input: {
      arg0: z.string(),
    },
    output: z.string(),
  },
  (d, i) => {
    console.log(d.a);
    return i.arg0 + i.arg0;
  }
);

const g = func(
  {
    deps: { b },
  },
  ({ b }) => {
    console.log(b);
  }
);

const fu = funcs({ f, g });
//const fun = fu.resolve({});
//fun.f({ arg0: "" });

const m = { f, g };
const mc: FuncsConfig<typeof m> = {
  a: {
    confA: "",
  },
  b: {
    confB: "",
  },
};
// TODO: generated cli
