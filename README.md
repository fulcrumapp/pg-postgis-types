# @fulcrumapp/pg-postgis-types

Use PostGIS geometry types with [node-postgres](https://github.com/brianc/node-postgres).

Registers parsers for PostGIS geometry types. You can also plug in your own WKB parser.

## Installation

```sh
npm install @fulcrumapp/pg-postgis-types
```

## Example

```ts
import { Pool } from 'pg';
import postgis from '@fulcrumapp/pg-postgis-types';
import pgCustomTypes from 'pg-custom-types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const exec = (sql: string, callback: (err: Error | null, result?: unknown) => void) => {
  pool.query(sql).then((r) => callback(null, r)).catch(callback);
};

// Initialize once at startup — registers pg type parsers
await postgis(exec, null);

const result = await pool.query("SELECT ST_GeomFromText('POINT(1 2)') AS geom");
console.log(result.rows[0].geom.toGeoJSON()); // { type: 'Point', coordinates: [1, 2] }
```

## API

### `postgis(exec, key)`

Fetches PostGIS OIDs and registers type parsers with `pg`. Returns a `Promise<void>`.

| parameter | type | description |
| --------- | ---- | ----------- |
| `exec` | `ExecFn` | A function of the form `(sql, callback) => void` used to query the database |
| `key` | `string \| null` | A unique key to namespace the type map (e.g. a schema name). Use `null` for the default schema. |

### `postgis.isGeometryType(oid, key)`

Returns `true` if the given OID is a geometry or geography type.

### `postgis.setGeometryParser(parser)`

Replaces the default WKB parser (`wkx`) with a custom one. The parser receives the raw hex string and should return a parsed geometry value.

### `postgis.getTypeParser(oid, key)`

Returns the registered parser function for the given OID, or `undefined`.

### `postgis.getTypeName(oid, key)` / `postgis.getTypeOID(name, key)`

Bidirectional lookup between OIDs and type names.

### `postgis.typename(typmod)`

Returns a human-readable type string from a PostgreSQL `typmod` value, e.g. `(Point,4326)`.

### `postgis.typeobj(typmod)`

Returns `{ type, srid, z, m, ndims }` decoded from a `typmod`.

### `postgis.geometryTypes`

Array of PostGIS geometry type names indexed by type code.

## Development

```sh
npm install
npm run build
npm test
npm run lint
```

## Publishing

Pull requests, merge queue entries and main changes run CI on GitHub-hosted
runners. After main validation succeeds, a GitHub App commits the next version
to `package.json` and creates its matching SemVer tag. Do not edit the root
package version manually. Tag creation starts the GitHub Packages publishing
workflow; this repository does not publish to npmjs.org.

Before enabling releases, configure fork-run approval, required CI checks,
GitHub Packages access, and the release App's branch and tag protection
bypasses. Disable the old Tekton publisher at cutover. If publishing fails,
rerun the tag workflow against the same tag; it verifies the release commit and
the package version before publishing.

## License

BSD-3-Clause
