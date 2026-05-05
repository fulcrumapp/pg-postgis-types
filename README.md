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

Releases are driven by git tags. The CI workflow reads the tag, sets `package.json` version to match, builds, and publishes to GitHub Packages — so the tag is always the source of truth.

To release:

```sh
# 1. Bump the version in package.json and commit
npm version 4.1.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to 4.1.0"
git push

# 2. Tag and push — this triggers the publish workflow
git tag v4.1.0
git push origin v4.1.0
```

The publish workflow will set `package.json` version from the tag before building, so even if they diverge the published artifact will always reflect the tag.

## License

BSD-3-Clause
