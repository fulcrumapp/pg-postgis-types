declare module '@fulcrumapp/pg-custom-types' {
  type Parser<T = unknown> = (value: string) => T;
  type Callback = (err: Error | null, result: Record<string, number>) => void;
  type ExecFn = (sql: string, callback: (err: Error | null, result?: unknown) => void) => void;

  interface PgCustomTypes {
    (exec: ExecFn, key: string, typeNames: string[], callback: Callback): void;
    allowNull<T>(parser: Parser<T>): Parser<T | null>;
    oids: Record<string, Record<string, number> | undefined>;
    names: Record<string, Record<string, string>>;
    fetcher(pg: unknown, connectionString: string): ExecFn;
    getTypeName(oid: number, key: string): string;
    getTypeOID(name: string, key: string): number;
  }

  const pgCustomTypes: PgCustomTypes;
  export = pgCustomTypes;
}
