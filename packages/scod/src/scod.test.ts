import { z } from "zod";
import { defineApplication, defineOperation, defineModule, Context } from "./scod";

class Driver {
  constructor(private secret: string) {}
}

class Client {
  constructor(private url: string, private driver: Driver) {}
  async fetch(name: string) {
    return `hello, ${name} (from ${this.url})`;
  }
}

describe("context tests", () => {
  it("should work when there are two dependencies of a module", async () => {
    const dep1 = defineModule(
      {
        name: "dep1",
        configuration: { value: z.number() },
      },
      () => 1
    );
    const dep2 = defineModule(
      {
        name: "dep2",
        configuration: { value: z.number() },
      },
      () => 2
    );
    const m = defineModule(
      {
        name: "m",
        dependencies: { dep1, dep2 },
      },
      () => "m"
    );
    await m.resolve({
      m: {},
      dep1: { value: 0 },
      dep2: { value: 1 },
    });
  });

  it("should work with a single module, function and application", async () => {
    let clientCalled = 0;
    const DRIVER = new Driver("secret");
    const CONFIG_URL = "localhost:8080";
    const PARAM_NAME = "bob";
    const client = defineModule(
      {
        name: "client",
        configuration: {
          url: z.string().url(),
        },
      },
      async (_, config) => {
        clientCalled++;
        return new Client(config.url, DRIVER);
      }
    );
    const getResult = defineOperation(
      {
        dependencies: { client },
        input: { name: z.string() },
        output: z.string(),
      },
      async ({ client }, { name }) => {
        return await client.fetch(name);
      }
    );
    expect(clientCalled).toBe(0);
    const app = await defineApplication({ getResult }).resolve({
      client: {
        url: CONFIG_URL,
      },
    });
    expect(clientCalled).toBe(1);
    const result = await app.getResult({ name: PARAM_NAME });
    const expectedResult = await new Client(CONFIG_URL, new Driver("")).fetch(PARAM_NAME);
    expect(result).toBe(expectedResult);
    expect(clientCalled).toBe(1);
  });

  it("should work with a single dependency in modules", async () => {
    let clientCalled = 0;
    let driverCalled = 0;
    const DRIVER_SECRET = "secret";
    const CONFIG_URL = "localhost:8080";
    const PARAM_NAME = "bob";
    const driver = defineModule(
      {
        name: "driver",
        configuration: {
          secret: z.string(),
        },
      },
      async (_, config) => {
        driverCalled++;
        return new Driver(config.secret);
      }
    );
    const client = defineModule(
      {
        name: "client",
        dependencies: { driver },
        configuration: {
          url: z.string().url(),
        },
      },
      async ({ driver }, config) => {
        clientCalled++;
        return new Client(config.url, driver);
      }
    );
    const getResult = defineOperation(
      {
        dependencies: { client },
        input: { name: z.string() },
        output: z.string(),
      },
      async ({ client }, { name }) => {
        return await client.fetch(name);
      }
    );
    expect(clientCalled).toBe(0);
    expect(driverCalled).toBe(0);
    const app = await defineApplication({ getResult }).resolve({
      client: {
        url: CONFIG_URL,
      },
      driver: {
        secret: DRIVER_SECRET,
      },
    });
    expect(clientCalled).toBe(1);
    expect(driverCalled).toBe(1);
    const result = await app.getResult({ name: PARAM_NAME });
    const expectedResult = await new Client(CONFIG_URL, new Driver(DRIVER_SECRET)).fetch(
      PARAM_NAME
    );
    expect(result).toBe(expectedResult);
    expect(clientCalled).toBe(1);
    expect(driverCalled).toBe(1);
  });

  it("should work lazily when we use the lazy variant", async () => {
    let clientCalled = 0;
    let driverCalled = 0;
    const DRIVER_SECRET = "secret";
    const CONFIG_URL = "localhost:8080";
    const PARAM_NAME = "bob";
    const driver = defineModule(
      {
        name: "driver",
        configuration: {
          secret: z.string(),
        },
      },
      async (_, config) => {
        driverCalled++;
        return new Driver(config.secret);
      }
    );
    const client = defineModule(
      {
        name: "client",
        dependencies: { driver },
        configuration: {
          url: z.string().url(),
        },
      },
      async ({ driver }, config) => {
        clientCalled++;
        return new Client(config.url, driver);
      }
    );
    const getResult = defineOperation(
      {
        dependencies: { client },
        input: { name: z.string() },
        output: z.string(),
      },
      async ({ client }, { name }) => {
        return await client.fetch(name);
      }
    );
    const app = defineApplication({ getResult }).lazy({
      client: {
        url: CONFIG_URL,
      },
      driver: {
        secret: DRIVER_SECRET,
      },
    });
    expect(clientCalled).toBe(0);
    expect(driverCalled).toBe(0);
    const result = await app.getResult({ name: PARAM_NAME });
    expect(clientCalled).toBe(1);
    expect(driverCalled).toBe(1);
    const expectedResult = await new Client(CONFIG_URL, new Driver(DRIVER_SECRET)).fetch(
      PARAM_NAME
    );
    expect(result).toBe(expectedResult);
  });

  it("should resolve module when we call it explicitly", async () => {
    let clientCalled = 0;
    let driverCalled = 0;
    const DRIVER_SECRET = "secret";
    const CONFIG_URL = "localhost:8080";
    const driver = defineModule(
      {
        name: "driver",
        configuration: {
          secret: z.string(),
        },
      },
      async (_, config) => {
        driverCalled++;
        return new Driver(config.secret);
      }
    );
    const client = defineModule(
      {
        name: "client",
        dependencies: { driver },
        configuration: {
          url: z.string().url(),
        },
      },
      async ({ driver }, config) => {
        clientCalled++;
        return new Client(config.url, driver);
      }
    );
    expect(clientCalled).toBe(0);
    expect(driverCalled).toBe(0);
    const m = await client.resolve({
      client: {
        url: CONFIG_URL,
      },
      driver: {
        secret: DRIVER_SECRET,
      },
    });
    expect(clientCalled).toBe(1);
    expect(driverCalled).toBe(1);
    expect(m).toBeInstanceOf(Client);
  });

  it("should default to empty object when no 'configuration' is given on module definition", async () => {
    const moduleWithNoConf = defineModule(
      {
        name: "moduleWithNoConf",
      },
      () => "modulWithNoConf"
    );
    expect(moduleWithNoConf.configuration).toEqual({});
  });

  it("should use the explicitly given context when resolving a module", async () => {
    let driverCalled = 0;
    let contextCalled = 0;
    const driver = defineModule(
      {
        name: "driver",
        configuration: { secret: z.string() },
      },
      async (_, config) => {
        driverCalled++;
        return new Driver(config.secret);
      }
    );
    const context = {
      resolve: (mod: any, _) => {
        expect(mod.name).toBe(driver.name);
        contextCalled++;
      },
    } as Context;
    expect(driverCalled).toBe(0);
    await driver.resolve({ driver: { secret: "secret" } }, context);
    expect(driverCalled).toBe(0);
    expect(contextCalled).toBe(1);
  });

  it("should default to empty object when no 'dependencies' or 'input' is given on operation definition", async () => {
    let opCalled = 0;
    const opDef = defineOperation({}, (deps, input) => {
      expect(deps).toEqual({});
      expect(input).toEqual({});
      opCalled++;
      return undefined;
    });
    expect(opCalled).toBe(0);
    const op = await opDef.resolve({});
    expect(opCalled).toBe(0);
    const result = await op({});
    expect(opCalled).toBe(1);
    expect(result).toBe(undefined);
    expect(opDef.dependencies).toEqual({});
    expect(opDef.input).toEqual({});
  });

  it("should create operation when calling 'resolve' on it", async () => {
    let clientCalled = 0;
    let driverCalled = 0;
    const DRIVER_SECRET = "secret";
    const CONFIG_URL = "localhost:8080";
    const PARAM_NAME = "bob";
    const driver = defineModule(
      {
        name: "driver",
        configuration: {
          secret: z.string(),
        },
      },
      async (_, config) => {
        driverCalled++;
        return new Driver(config.secret);
      }
    );
    const client = defineModule(
      {
        name: "client",
        dependencies: { driver },
        configuration: {
          url: z.string().url(),
        },
      },
      async ({ driver }, config) => {
        clientCalled++;
        return new Client(config.url, driver);
      }
    );
    const getResult = defineOperation(
      {
        dependencies: { client },
        input: { name: z.string() },
        output: z.string(),
      },
      async ({ client }, { name }) => {
        return await client.fetch(name);
      }
    );
    expect(clientCalled).toBe(0);
    expect(driverCalled).toBe(0);
    const op = await getResult.resolve({
      client: {
        url: CONFIG_URL,
      },
      driver: {
        secret: DRIVER_SECRET,
      },
    });
    expect(clientCalled).toBe(1);
    expect(driverCalled).toBe(1);
    const result = await op({ name: PARAM_NAME });
    const expectedResult = await new Client(CONFIG_URL, new Driver(DRIVER_SECRET)).fetch(
      PARAM_NAME
    );
    expect(result).toBe(expectedResult);
    expect(clientCalled).toBe(1);
    expect(driverCalled).toBe(1);
  });

  it("should use the explicitly given context when resolving an application", async () => {
    let clientCalled = 0;
    let contextCalled = 0;
    const DRIVER = new Driver("secret");
    const CONFIG_URL = "localhost:8080";
    const client = defineModule(
      {
        name: "client",
        configuration: {
          url: z.string().url(),
        },
      },
      async (_, config) => {
        clientCalled++;
        return new Client(config.url, DRIVER);
      }
    );
    const getResult = defineOperation(
      {
        dependencies: { client },
        input: { name: z.string() },
        output: z.string(),
      },
      async ({ client }, { name }) => {
        return await client.fetch(name);
      }
    );
    const context = {
      resolve: (mod: any, _) => {
        expect(mod.name).toBe(client.name);
        contextCalled++;
      },
    } as Context;
    await defineApplication({ getResult }).resolve(
      {
        client: {
          url: CONFIG_URL,
        },
      },
      context
    );
    expect(clientCalled).toBe(0);
    expect(contextCalled).toBe(1);
  });

  it("should use the explicitly given context when calling an operation on a lazily created application", async () => {
    let clientCalled = 0;
    let contextCalled = 0;
    const DRIVER = new Driver("secret");
    const CONFIG_URL = "localhost:8080";
    const client = defineModule(
      {
        name: "client",
        configuration: {
          url: z.string().url(),
        },
      },
      async (_, config) => {
        clientCalled++;
        return new Client(config.url, DRIVER);
      }
    );
    const getResult = defineOperation(
      {
        dependencies: { client },
        input: { name: z.string() },
        output: z.string(),
      },
      async ({ client }, { name }) => {
        return await client.fetch(name);
      }
    );
    const context = {
      resolve: (mod: any, _) => {
        expect(mod.name).toBe(client.name);
        contextCalled++;
        return new Client(CONFIG_URL, DRIVER) as any;
      },
    } as Context;
    const app = defineApplication({ getResult }).lazy(
      {
        client: {
          url: CONFIG_URL,
        },
      },
      context
    );
    expect(contextCalled).toBe(0);
    await app.getResult({ name: "bob" });
    expect(contextCalled).toBe(1);
    expect(clientCalled).toBe(0);
  });
});
