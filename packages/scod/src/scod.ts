/* eslint-disable @typescript-eslint/ban-types */
import { z } from "zod";
import { SameKeys } from "./util";

type Val<T> = T[keyof T];
type OrEmpty<D> = D extends {} ? D : {};
type OrZodVoid<D> = D extends z.ZodType ? D : z.ZodVoid;
type AnyDeps<D extends Deps> = keyof (D & { 0: 0 }) extends 0 ? undefined : D;

type Module<T = any, N extends string = any, D extends Deps = any, C extends Conf = any> = {
  name: N;
  dependencies: D;
  configuration: C;
  create: Factory<T, D, C>;
  resolve: ResolveModule<T, N, D, C>;
};

type Deps = { [key: string]: Module };

type Conf = Record<string, z.ZodType>;

type Factory<T = any, D extends Deps = any, C extends Conf = any> = (
  dependencies: Satisfied<D>,
  configuration: ConfigValue<C>
) => Promise<T> | T;

type ResolveModule<T, N extends string = any, D extends Deps = any, C extends Conf = any> = (
  config: ConfigMap<N, D, C>,
  ctx?: Context
) => Promise<T>;

type DepsConfig<D extends Deps> = D extends AnyDeps<D> ? Parameters<Val<D>["resolve"]>[0] : {};

type ConfigMap<N extends string, D extends Deps, C extends Conf> = {
  [K in N]: ConfigValue<C>;
} & DepsConfig<D>;

type Satisfied<D extends Deps> = {
  [M in Val<D> as M["name"]]: Awaited<ReturnType<M["create"]>>;
} & (D extends AnyDeps<D> ? Parameters<Val<D>["create"]>[0] : {});

type ConfigValue<C extends Conf> = { [K in keyof C]: z.infer<C[K]> };

type ModuleOpts<N extends string> = {
  name: N;
  dependencies?: Deps;
  configuration?: Conf;
};

type Operation<D extends Deps = any, I extends Input = any, O extends Output = any> = {
  dependencies: D;
  input: I;
  output: O;
  handle: Handler<D, I, O>;
  resolve: ResolveHandler<D, I, O>;
};

type Input = Record<string, z.ZodType>;
type Output = z.ZodType;
type InputValue<I extends Input> = { [K in keyof I]: z.infer<I[K]> };
type OutputValue<O extends Output> = z.infer<O>;

type Handler<D extends Deps = any, I extends Input = any, O extends Output = any> = (
  deps: Satisfied<D>,
  input: InputValue<I>
) => Promise<z.infer<O>> | z.infer<O>;

type ResolveHandler<D extends Deps, I extends Input, O extends Output> = (
  conf: DepsConfig<D>,
  ctx?: Context
) => Promise<(input: InputValue<I>) => Promise<OutputValue<O>>>;

type OperationOpts = {
  dependencies?: Deps;
  input?: Input;
  output?: Output;
};

type Operations = { [key: string]: Operation };

type ApplicationConfig<M extends Operations> = Parameters<Val<M>["resolve"]>[0];

type CallableOperations<M extends Operations> = {
  [K in keyof M]: Awaited<ReturnType<M[K]["resolve"]>>;
};

type Application<M extends Operations> = {
  operations: M;
  resolve: (conf: ApplicationConfig<M>, ctx?: Context) => Promise<CallableOperations<M>>;
  lazy: (conf: Partial<ApplicationConfig<M>>, ctx?: Context) => CallableOperations<M>;
};

export class Context {
  private readonly resolved: { [key: string]: unknown } = {};
  async resolve<T>(module: Module<T>, conf: Record<string, unknown>): Promise<T> {
    if (!this.resolved[module.name]) {
      const satisfied: Deps = {};
      for (const k in module.dependencies) {
        satisfied[k] = await this.resolve(module.dependencies[k], conf);
      }
      const confType = z.object({ [module.name]: z.strictObject(module.configuration) });
      const config = confType.parse(conf)[module.name];
      this.resolved[module.name] = await module.create(satisfied, config);
    }
    return this.resolved[module.name] as T;
  }
}

export function defineModule<
  T,
  N extends string,
  O extends SameKeys<O, ModuleOpts<N>>,
  M extends Module<T, O["name"], OrEmpty<O["dependencies"]>, OrEmpty<O["configuration"]>>
>(opts: O, create: M["create"]): M {
  const result = {
    name: opts.name,
    dependencies: opts.dependencies ?? {},
    configuration: opts.configuration ?? {},
    create,
  } as Module;
  const resolve: M["resolve"] = (conf, ctx) => (ctx ?? new Context()).resolve(result, conf);
  return { ...result, resolve } as M;
}

export function defineOperation<
  O extends OperationOpts,
  F extends Operation<OrEmpty<O["dependencies"]>, OrEmpty<O["input"]>, OrZodVoid<O["output"]>>
>(opts: O, handle: F["handle"]): F {
  const result = {
    dependencies: opts.dependencies ?? {},
    input: opts.input ?? {},
    output: opts.output ?? z.void(),
    handle,
  } as F;
  const resolve: F["resolve"] = async (conf, ctx) => {
    const context = ctx ?? new Context();
    const inputType = z.object(result.input);
    const outputType = result.output;
    const deps: Record<string, unknown> = {};
    for (const k in result.dependencies) {
      deps[k] = await context.resolve((result.dependencies as Deps)[k], conf);
    }
    return async (input) => {
      const output = await result.handle(deps as any, inputType.parse(input) as any);
      return outputType.parse(output);
    };
  };
  return { ...result, resolve };
}

export function defineApplication<M extends Operations>(operations: M): Application<M> {
  const configMap: Record<string, z.ZodType> = {};
  const visitDeps = (deps: Deps) => {
    for (const k in deps) {
      configMap[k] = z.strictObject(deps[k].configuration);
      visitDeps(deps[k].dependencies);
    }
  };
  for (const k in operations) {
    visitDeps(operations[k].dependencies);
  }
  return {
    operations: operations,
    resolve: async (conf, ctx) => {
      const context = ctx ?? new Context();
      const config = z.object(configMap).parse(conf);
      const result: Record<string, unknown> = {};
      for (const k in operations) {
        result[k] = await operations[k].resolve(config, context);
      }
      return result as any;
    },
    lazy: (conf, ctx) => {
      const context = ctx ?? new Context();
      const config = z.object(configMap).partial().parse(conf);
      const result: Record<string, unknown> = {};
      for (const k in operations) {
        result[k] = async (input: any) => {
          const f = await operations[k].resolve(config, context);
          const output = await f(input);
          return output;
        };
      }
      return result as any;
    },
  };
}
