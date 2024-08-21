type KeysWithOptional<T> = {
  [K in keyof T]-?: {} extends { [P in K]: T[K] } ? K : never;
}[keyof T];

type MergedProperties<A, B, K extends keyof A & keyof B> = {
  [P in K]: A[P] | Exclude<B[P], undefined>;
};

type Identity<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

type MergeImplement<A, B> = Identity<
  Pick<B, Exclude<keyof B, keyof A>> &
    Pick<A, Exclude<keyof A, KeysWithOptional<A>>> &
    Pick<A, Exclude<KeysWithOptional<A>, keyof B>> &
    MergedProperties<B, A, KeysWithOptional<A> & keyof B>
>;

export type Merge<L extends readonly [...any]> = L extends [infer A, ...infer B]
  ? MergeImplement<A, Merge<B>>
  : unknown;

const findObj = <T extends object>(
  objs: T[],
  p: string | number | symbol
): any => objs.find((o) => p in o) || objs[0];

const Merged = Symbol("Merged");

export function merge<T extends object[]>(...objs: [...T]): Merge<T> {
  objs.unshift({
    [Symbol.for("nodejs.util.inspect.custom")]() {
      const obj: any = {};
      for (const o of objs) for (const k in o) obj[k] = o[k];
      return obj;
    },
  });
  // @ts-ignore
  objs = Object.freeze(
    objs
      .map((i) => (Merged in i ? (i[Merged] as [...T]).slice(1) : (i as T)))
      .flat()
  );
  return new Proxy(objs[0], {
    has: (t, p) => objs.some((o) => p in o),
    get: (t, p) => (p === Merged ? objs : findObj(objs, p)[p]),
    set: (t, p, v) => Reflect.set(findObj(objs, p), p, v),
    deleteProperty: (t, p) => Reflect.deleteProperty(findObj(objs, p), p),
    ownKeys: (t) =>
      objs.reduce(
        (p, c) => p.concat(Reflect.ownKeys(c).filter((i) => !p.includes(i))),
        Reflect.ownKeys(t)
      ),
    defineProperty: (t, p, a) => Reflect.defineProperty(findObj(objs, p), p, a),
    getOwnPropertyDescriptor: (t, p) =>
      Reflect.getOwnPropertyDescriptor(findObj(objs, p), p),
  }) as Merge<T>;
}

export const nullPrototype = Reflect.getPrototypeOf({});

export function getPrototypesOf(obj: object): object[] {
  const chain = [obj];
  while (true) {
    const prototype = Reflect.getPrototypeOf(obj)!;
    if (prototype === nullPrototype) return chain;
    chain.push(prototype);
    obj = prototype;
  }
}

export function getAllKeys(obj: object): (string | symbol)[] {
  const prototypes = getPrototypesOf(obj);
  if (prototypes.length === 1) return Reflect.ownKeys(obj);
  return prototypes.reduce((prev: (string | symbol)[], curr) => {
    Reflect.ownKeys(curr).forEach((k) => {
      if (!prev.includes(k) && k !== "constructor") prev.push(k);
    });
    return prev;
  }, []);
}

export function getAllDescriptors<T extends object>(obj: T) {
  const prototypes = getPrototypesOf(obj);
  const descriptors = prototypes
    .reverse()
    .reduceRight(
      (prev, curr) =>
        Object.assign(prev, Object.getOwnPropertyDescriptors(curr)),
      {}
    ) as { [P in keyof T]: TypedPropertyDescriptor<T[P]> } & {
    [x: string]: PropertyDescriptor;
  };
  if (prototypes.length > 1) Reflect.deleteProperty(descriptors, "constructor");
  return descriptors;
}

export const isObject = (value: any): value is object =>
  typeof value === "object" && value !== null;

type CircularPointer = { o: number | `${number}` };

export function decircular(obj: object): object[];
export function decircular(
  obj: object,
  level: number,
  objectLevels: object[][],
  objectIds: Map<object, CircularPointer>,
  encodedObjects: Map<object, object>
): CircularPointer;
export function decircular(
  obj: object,
  level = 0,
  objectLevels: object[][] = [],
  objectIds = new Map<object, CircularPointer>(),
  encodedObjects = new Map<object, object>()
) {
  // Skip already recorded object
  if (objectIds.has(obj)) return objectIds.get(obj)!;

  // Record the object
  const objectId: CircularPointer = { o: -1 };
  const encodedObject: any = {};
  (objectLevels[level] || (objectLevels[level] = [])).push(obj);
  objectIds.set(obj, objectId);
  encodedObjects.set(obj, encodedObject);

  // Encode the object, finding more objects in the process
  const descriptors = getAllDescriptors(obj);
  for (const key in descriptors) {
    const descriptor = descriptors[key];
    if (descriptor.get) continue;
    const { value } = descriptor;
    encodedObject[key] = isObject(value)
      ? decircular(value, level + 1, objectLevels, objectIds, encodedObjects)
      : value;
  }

  // If top-level stack, return encoded objects
  if (level === 0) {
    const sortedObjects: object[] = [];
    let index = 0;
    objectLevels.forEach((level) => {
      level.forEach((o) => {
        sortedObjects.push(o);
        objectIds.get(o)!.o = `${index++}`;
      });
    });
    return sortedObjects.map((o) => encodedObjects.get(o)!) as object[];
  }

  return objectId;
}

export function encircular<T extends object = object>(series: object[]): T {
  const root = series[0];
  for (const obj of series) {
    for (const k in obj) {
      const v = (obj as any)[k];
      if (isObject(v)) (obj as any)[k] = series[(v as CircularPointer).o];
    }
  }
  return root as T;
}

export type PickKeys<
  T,
  K extends Array<keyof T> | undefined = undefined
> = K extends undefined ? T : Pick<T, K extends Array<infer U> ? U : never>;

export type OmitKeys<
  T,
  K extends Array<keyof T> | undefined = undefined
> = K extends undefined ? T : Omit<T, K extends Array<infer U> ? U : never>;

export function pick<T extends object, K extends Array<keyof T>>(
  obj: T,
  keys: K
) {
  return new Proxy(obj, {
    get(t, p: any) {
      if (keys.includes(p)) return Reflect.get(t, p);
      return undefined;
    },
    set(t, p: any, v: any) {
      if (keys.includes(p)) return Reflect.set(t, p, v);
      return false;
    },
    has(t, p: any) {
      if (keys.includes(p)) return Reflect.has(t, p);
      return false;
    },
    ownKeys(t) {
      return Reflect.ownKeys(t).filter((i: any) => keys.includes(i));
    },
    deleteProperty(t, p: any) {
      if (keys.includes(p)) return Reflect.deleteProperty(t, p);
      return false;
    },
  }) as PickKeys<T, K>;
}

export function omit<T extends object, K extends Array<keyof T>>(
  obj: T,
  keys: K
) {
  return new Proxy(obj, {
    get(t, p: any) {
      if (keys.includes(p)) return undefined;
      return Reflect.get(t, p);
    },
    set(t, p: any, v: any) {
      if (keys.includes(p)) return false;
      return Reflect.set(t, p, v);
    },
    has(t, p: any) {
      if (keys.includes(p)) return false;
      return Reflect.has(t, p);
    },
    ownKeys(t) {
      return Reflect.ownKeys(t).filter((i: any) => !keys.includes(i));
    },
    deleteProperty(t, p: any) {
      if (keys.includes(p)) return false;
      return Reflect.deleteProperty(t, p);
    },
  }) as OmitKeys<T, K>;
}

export function readOnly<T extends object, K extends Array<keyof T>>(
  obj: T,
  keys?: K
): T;
export function readOnly<T extends object, K extends Array<keyof T>>(
  obj: T,
  _keys?: K
) {
  const keys = _keys || null;
  return new Proxy(obj, {
    set(t, p: any, v: any) {
      if (!keys || keys.includes(p)) return false;
      return Reflect.set(t, p, v);
    },
    deleteProperty(t, p: any) {
      if (!keys || keys.includes(p)) return false;
      return Reflect.deleteProperty(t, p);
    },
  }) as T;
}

export function writeOnly<T extends object, K extends Array<keyof T>>(
  obj: T,
  keys?: K
): T;
export function writeOnly<T extends object, K extends Array<keyof T>>(
  obj: T,
  _keys?: K
) {
  const keys = _keys || null;
  return new Proxy(obj, {
    get(t, p: any) {
      if (!keys || keys.includes(p)) return undefined;
      return Reflect.get(t, p);
    },
  }) as T;
}
