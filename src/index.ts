import { parse as parseWkb } from 'well-known-parser';
import { parse as parseArray } from 'postgres-array';
import pgCustomTypes from '@fulcrumapp/pg-custom-types';
import pg from 'pg';

export type GeometryParser = (value: string) => unknown;
export type ExecFn = (sql: string, callback: (err: Error | null, result?: unknown) => void) => void;

export interface TypeObj {
  type: number;
  srid: number;
  z: number;
  m: number;
  ndims: number;
}

const POSTGIS = 'postgis';

const TYPENAMES = [
  'geometry',
  'geometry_dump',
  'geography',
  'box2d',
  'box3d',
  '_geometry',
  '_geometry_dump',
  '_geography',
  '_box2d',
  '_box3d',
] as const;

const POSTGIS_TYPES = [
  'Unknown',
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
  'GeometryCollection',
  'CircularString',
  'CompoundCurve',
  'CurvePolygon',
  'MultiCurve',
  'MultiSurface',
  'PolyhedralSurface',
  'Triangle',
  'Tin',
] as const;

// Module-level state keyed by schema key
const GEOMETRY_OIDS: Record<string, number | undefined> = {};
const GEOMETRY_ARRAY_OIDS: Record<string, number | undefined> = {};
const GEOGRAPHY_OIDS: Record<string, number | undefined> = {};
const GEOGRAPHY_ARRAY_OIDS: Record<string, number | undefined> = {};
const TYPE_PARSERS: Record<string, Record<number, (value: string) => unknown>> = {};

let parseGeometryHandler: GeometryParser = (value: string) =>
  parseWkb(Buffer.from(value, 'hex'));

function typeNameKey(key?: string | null): string {
  return key ? `${POSTGIS}-${key}` : POSTGIS;
}

function parseGeometry(value: string): unknown {
  return parseGeometryHandler(value);
}

function parseBox(value: string): number[][] {
  const inner = value.substring(value.indexOf('(') + 1, value.indexOf(')'));
  return inner.split(',').map((pair) => pair.trim().split(' ').map(Number));
}

function wrapPostgisArray(parser: (value: string) => unknown): (value: string) => unknown {
  return pgCustomTypes.allowNull((value: string) =>
    parseArray(value.replaceAll(':', ','), pgCustomTypes.allowNull(parser) as (v: string) => unknown),
  );
}

const parsers: Record<string, (value: string) => unknown> = {
  geometry: pgCustomTypes.allowNull(parseGeometry),
  geography: pgCustomTypes.allowNull(parseGeometry),
  box2d: pgCustomTypes.allowNull(parseBox),
  box3d: pgCustomTypes.allowNull(parseBox),
  _geometry: wrapPostgisArray(parseGeometry),
  _geography: wrapPostgisArray(parseGeometry),
  _box2d: wrapPostgisArray(parseBox),
  _box3d: wrapPostgisArray(parseBox),
};

// Standalone bit-extraction helpers used by both the public API methods and
// internally so that methods don't need to self-reference `postgis` at call time.
function sridBit(mod: number): number { return (((mod) & 0x1FFFFF00) << 3) >> 11; }
function typeBit(mod: number): number { return (mod & 0x000000FC) >> 2; }
function zBit(mod: number): number { return (mod & 0x00000002) >> 1; }
function mBit(mod: number): number { return mod & 0x00000001; }

async function postgisImpl(exec: ExecFn, key?: string | null): Promise<void> {
  const resolvedKey = typeNameKey(key);

  if (pgCustomTypes.oids[resolvedKey]?.geometry != null) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    pgCustomTypes(exec, resolvedKey, [...TYPENAMES], (err, res) => {
      if (err) {
        reject(err);
        return;
      }

      TYPE_PARSERS[resolvedKey] ??= {};

      for (const parserName of Object.keys(parsers)) {
        const oid = res[parserName];
        if (oid) {
          pg.types.setTypeParser(oid, parsers[parserName] as (value: string) => unknown);
          TYPE_PARSERS[resolvedKey][oid] = parsers[parserName];
        }
      }

      GEOMETRY_OIDS[resolvedKey] = res.geometry;
      GEOMETRY_ARRAY_OIDS[resolvedKey] = res._geometry;
      GEOGRAPHY_OIDS[resolvedKey] = res.geography;
      GEOGRAPHY_ARRAY_OIDS[resolvedKey] = res._geography;

      postgis.names[resolvedKey] = pgCustomTypes.names[resolvedKey] ?? {};
      postgis.oids[resolvedKey] = pgCustomTypes.oids[resolvedKey] ?? {};

      resolve();
    });
  });
}

const postgis = Object.assign(postgisImpl, {
  names: {} as Record<string, Record<string, string>>,
  oids: {} as Record<string, Record<string, number>>,

  isGeometryType(oid: number, key?: string | null): boolean {
    const k = typeNameKey(key);
    return (
      oid === GEOMETRY_OIDS[k] ||
      oid === GEOGRAPHY_OIDS[k] ||
      oid === GEOMETRY_ARRAY_OIDS[k] ||
      oid === GEOGRAPHY_ARRAY_OIDS[k]
    );
  },

  setGeometryParser(parser: GeometryParser): void {
    parseGeometryHandler = parser;
  },

  getTypeParser(oid: number, key?: string | null): ((value: string) => unknown) | undefined {
    return TYPE_PARSERS[typeNameKey(key)]?.[oid];
  },

  getTypeName(oid: number, key?: string | null): string {
    return pgCustomTypes.getTypeName(oid, typeNameKey(key));
  },

  getTypeOID(name: string, key?: string | null): number {
    return pgCustomTypes.getTypeOID(name, typeNameKey(key));
  },

  srid: sridBit,
  type: typeBit,
  z: zBit,
  m: mBit,

  ndims(mod: number): number {
    return 2 + zBit(mod) + mBit(mod);
  },

  typename(mod: number): string {
    if (mod < 0) {
      return '';
    }

    const type = typeBit(mod);
    const srid = sridBit(mod);
    const z = zBit(mod);
    const m = mBit(mod);

    if (!(type || srid || z | m)) {
      return '';
    }

    let name = '(';
    name += type ? POSTGIS_TYPES[type] : 'Geometry';
    if (z) name += 'Z';
    if (m) name += 'M';
    if (srid > 0) name += `,${srid}`;
    name += ')';

    return name;
  },

  typeobj(mod: number): TypeObj {
    return {
      type: typeBit(mod),
      srid: sridBit(mod),
      z: zBit(mod),
      m: mBit(mod),
      ndims: 2 + zBit(mod) + mBit(mod),
    };
  },

  geometryTypes: [...POSTGIS_TYPES] as string[],
});

export default postgis;
