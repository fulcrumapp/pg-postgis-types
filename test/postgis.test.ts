/// <reference types="jest" />

import { parse as parseWkb } from 'well-known-parser';
import postgis, { type ExecFn, type Geometry } from '../src/index';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Fake OIDs that will never collide with real pg built-in type OIDs.
const OID = {
  geometry:   50001,
  _geometry:  50002,
  geography:  50003,
  _geography: 50004,
  box2d:      50005,
  box3d:      50006,
  _box2d:     50007,
  _box3d:     50008,
};

// Unique schema key so this suite's state never bleeds into others.
const KEY = 'unit-test';

// Mock exec: simulates the `SELECT oid, typname FROM pg_type` result that
// @fulcrumapp/pg-custom-types issues internally.
const mockExec: ExecFn = (_sql, callback) => {
  const rows = Object.entries(OID).map(([name, oid]) => ({ name, oid: String(oid) }));
  callback(null, rows);
};

// Known-good WKB hex strings (little-endian, uncompressed).
const WKB = {
  POINT_1_2:        '0101000000000000000000F03F0000000000000040', // POINT(1 2)
  LINESTRING_0_0_4_1: '010200000002000000000000000000000000000000000000000000000000001040000000000000F03F',
  POLYGON:          '0103000000010000000500000000000000000000000000000000000000000000000000F03F00000000000000000000000000000000000000000000F03F0000000000000000000000000000000000000000000000000000000000000000',
};

// ---------------------------------------------------------------------------
// Setup: initialise postgis with the mock exec once before all tests.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await postgis(mockExec, KEY);
});

// ---------------------------------------------------------------------------
// Initialisation behaviour
// ---------------------------------------------------------------------------

describe('initialisation', () => {
  it('is idempotent — second call with the same key skips the query', async () => {
    let callCount = 0;
    const countingExec: ExecFn = (sql, cb) => { callCount++; mockExec(sql, cb); };
    await postgis(countingExec, KEY); // already initialised → should skip
    expect(callCount).toBe(0);
  });

  it('rejects when exec returns an error', async () => {
    const errorExec: ExecFn = (_sql, cb) => cb(new Error('connection refused'));
    await expect(postgis(errorExec, 'error-key')).rejects.toThrow('connection refused');
  });
});

// ---------------------------------------------------------------------------
// Geometry (WKB) parsing
// ---------------------------------------------------------------------------

describe('geometry parsing', () => {
  it('parses a POINT WKB hex string to a GeoJSON-capable object', () => {
    const result = postgis.getTypeParser(OID.geometry, KEY)?.(WKB.POINT_1_2) as Geometry;
    expect(result.toGeoJSON()).toEqual({ type: 'Point', coordinates: [1, 2] });
  });

  it('parses a LineString WKB', () => {
    const result = postgis.getTypeParser(OID.geometry, KEY)?.(WKB.LINESTRING_0_0_4_1) as Geometry;
    const geojson = result.toGeoJSON() as { type: string; coordinates: number[][] };
    expect(geojson.type).toBe('LineString');
    expect(geojson.coordinates).toEqual([[0, 0], [4, 1]]);
  });

  it('parses a Polygon WKB', () => {
    const result = postgis.getTypeParser(OID.geometry, KEY)?.(WKB.POLYGON) as Geometry;
    expect((result.toGeoJSON() as { type: string }).type).toBe('Polygon');
  });

  it('returns null for a null geometry value (allowNull wrapper)', () => {
    expect(postgis.getTypeParser(OID.geometry, KEY)?.(null as unknown as string)).toBeNull();
  });

  it('geography parser behaves identically to geometry parser', () => {
    const result = postgis.getTypeParser(OID.geography, KEY)?.(WKB.POINT_1_2) as Geometry;
    expect(result.toGeoJSON()).toEqual({ type: 'Point', coordinates: [1, 2] });
  });
});

// ---------------------------------------------------------------------------
// Box2D / Box3D parsing
// ---------------------------------------------------------------------------

describe('box2d parsing', () => {
  it('parses a BOX(x1 y1,x2 y2) string', () => {
    expect(postgis.getTypeParser(OID.box2d, KEY)?.('BOX(1 2,5 6)')).toEqual([[1, 2], [5, 6]]);
  });

  it('returns null for a null box value', () => {
    expect(postgis.getTypeParser(OID.box2d, KEY)?.(null as unknown as string)).toBeNull();
  });

  it('handles negative coordinates', () => {
    expect(postgis.getTypeParser(OID.box2d, KEY)?.('BOX(-180 -90,180 90)')).toEqual([[-180, -90], [180, 90]]);
  });

  it('handles floating-point coordinates', () => {
    expect(postgis.getTypeParser(OID.box2d, KEY)?.('BOX(-1.5 2.75,3.1 4.99)')).toEqual([[-1.5, 2.75], [3.1, 4.99]]);
  });
});

// ---------------------------------------------------------------------------
// isGeometryType
// ---------------------------------------------------------------------------

describe('isGeometryType', () => {
  it('returns true for the geometry OID', () =>
    expect(postgis.isGeometryType(OID.geometry, KEY)).toBe(true));

  it('returns true for the geography OID', () =>
    expect(postgis.isGeometryType(OID.geography, KEY)).toBe(true));

  it('returns true for the geometry array OID', () =>
    expect(postgis.isGeometryType(OID._geometry, KEY)).toBe(true));

  it('returns true for the geography array OID', () =>
    expect(postgis.isGeometryType(OID._geography, KEY)).toBe(true));

  it('returns false for an unregistered OID', () =>
    expect(postgis.isGeometryType(9999, KEY)).toBe(false));

  it('returns false for OID 0', () =>
    expect(postgis.isGeometryType(0, KEY)).toBe(false));

  it('returns false for a negative OID', () =>
    expect(postgis.isGeometryType(-1, KEY)).toBe(false));
});

// ---------------------------------------------------------------------------
// getTypeParser
// ---------------------------------------------------------------------------

describe('getTypeParser', () => {
  it('returns a function for a registered geometry OID', () =>
    expect(typeof postgis.getTypeParser(OID.geometry, KEY)).toBe('function'));

  it('returns a function for a registered box2d OID', () =>
    expect(typeof postgis.getTypeParser(OID.box2d, KEY)).toBe('function'));

  it('returns undefined for an unknown OID', () =>
    expect(postgis.getTypeParser(9999, KEY)).toBeUndefined());

  it('returns undefined for OID 0', () =>
    expect(postgis.getTypeParser(0, KEY)).toBeUndefined());
});

// ---------------------------------------------------------------------------
// getTypeName / getTypeOID
// ---------------------------------------------------------------------------

describe('getTypeName / getTypeOID', () => {
  it('round-trips name → OID → name for geometry', () => {
    const oid = postgis.getTypeOID('geometry', KEY);
    expect(postgis.getTypeName(oid, KEY)).toBe('geometry');
  });

  it('returns the correct fake OID for geography', () =>
    expect(postgis.getTypeOID('geography', KEY)).toBe(OID.geography));

  it('returns the correct fake OID for box2d', () =>
    expect(postgis.getTypeOID('box2d', KEY)).toBe(OID.box2d));
});

// ---------------------------------------------------------------------------
// setGeometryParser
// ---------------------------------------------------------------------------

describe('setGeometryParser', () => {
  afterEach(() => {
    // Always restore the default parser so other tests are unaffected.
    postgis.setGeometryParser((value: string) => parseWkb(Buffer.from(value, 'hex')));
  });

  it('overrides the geometry parser globally', () => {
    const sentinel = Symbol('sentinel');
    postgis.setGeometryParser(() => sentinel);
    expect(postgis.getTypeParser(OID.geometry, KEY)?.(WKB.POINT_1_2)).toBe(sentinel);
  });

  it('the override also affects the geography parser', () => {
    postgis.setGeometryParser(() => 'custom-result');
    expect(postgis.getTypeParser(OID.geography, KEY)?.(WKB.POINT_1_2)).toBe('custom-result');
  });

  it('restoring the default parser produces correct GeoJSON again', () => {
    postgis.setGeometryParser(() => 'broken');
    postgis.setGeometryParser((value: string) => parseWkb(Buffer.from(value, 'hex')));
    const result = postgis.getTypeParser(OID.geometry, KEY)?.(WKB.POINT_1_2) as Geometry;
    expect(result.toGeoJSON()).toEqual({ type: 'Point', coordinates: [1, 2] });
  });
});

// ---------------------------------------------------------------------------
// typename — pure function, no DB required
// ---------------------------------------------------------------------------

describe('typename', () => {
  // Mod encoding:
  //   bits 28-8 → SRID  (srid << 8)
  //   bits 7-2  → type  (type << 2)
  //   bit  1    → Z
  //   bit  0    → M

  it('returns empty string for mod < 0', () => {
    expect(postgis.typename(-1)).toBe('');
    expect(postgis.typename(-999)).toBe('');
  });

  it('returns empty string for mod = 0 (no type info)', () =>
    expect(postgis.typename(0)).toBe(''));

  it('returns (Point) for type=1, no SRID/Z/M', () =>
    // type=1 → 1<<2 = 4
    expect(postgis.typename(4)).toBe('(Point)'));

  it('returns (LineString) for type=2', () =>
    expect(postgis.typename(8)).toBe('(LineString)'));

  it('returns (Polygon) for type=3', () =>
    expect(postgis.typename(12)).toBe('(Polygon)'));

  it('returns (Point,4326) for type=1, SRID=4326', () =>
    // mod = (4326 << 8) | (1 << 2) = 1107460
    expect(postgis.typename(1107460)).toBe('(Point,4326)'));

  it('returns (Geometry,4326) when type bits are zero but SRID is set', () =>
    // mod = 4326 << 8 = 1107456
    expect(postgis.typename(1107456)).toBe('(Geometry,4326)'));

  it('appends Z for 3D geometry', () =>
    // type=1, Z=1 → 4 | 2 = 6
    expect(postgis.typename(6)).toBe('(PointZ)'));

  it('appends M for measured geometry', () =>
    // type=1, M=1 → 4 | 1 = 5
    expect(postgis.typename(5)).toBe('(PointM)'));

  it('appends ZM for 4D geometry', () =>
    // type=1, Z=1, M=1 → 4 | 2 | 1 = 7
    expect(postgis.typename(7)).toBe('(PointZM)'));

  it('covers all named geometry types', () => {
    const expected = [
      'Point', 'LineString', 'Polygon', 'MultiPoint',
      'MultiLineString', 'MultiPolygon', 'GeometryCollection',
    ];
    expected.forEach((name, idx) => {
      const mod = (idx + 1) << 2; // types start at 1
      expect(postgis.typename(mod)).toBe(`(${name})`);
    });
  });
});

// ---------------------------------------------------------------------------
// typeobj — pure function, no DB required
// ---------------------------------------------------------------------------

describe('typeobj', () => {
  it('returns all zeros (except ndims=2) for mod 0', () =>
    expect(postgis.typeobj(0)).toEqual({ type: 0, srid: 0, z: 0, m: 0, ndims: 2 }));

  it('extracts type correctly', () => {
    expect(postgis.typeobj(4).type).toBe(1);  // Point
    expect(postgis.typeobj(8).type).toBe(2);  // LineString
    expect(postgis.typeobj(12).type).toBe(3); // Polygon
  });

  it('extracts SRID correctly', () => {
    expect(postgis.typeobj(1107460).srid).toBe(4326);
    expect(postgis.typeobj(0).srid).toBe(0);
  });

  it('extracts Z flag', () => {
    expect(postgis.typeobj(6).z).toBe(1); // 4 | 2
    expect(postgis.typeobj(4).z).toBe(0);
  });

  it('extracts M flag', () => {
    expect(postgis.typeobj(5).m).toBe(1); // 4 | 1
    expect(postgis.typeobj(4).m).toBe(0);
  });

  it('computes ndims: 2 for 2D, 3 for Z or M, 4 for ZM', () => {
    expect(postgis.typeobj(4).ndims).toBe(2); // 2D
    expect(postgis.typeobj(6).ndims).toBe(3); // Z
    expect(postgis.typeobj(5).ndims).toBe(3); // M
    expect(postgis.typeobj(7).ndims).toBe(4); // ZM
  });
});

// ---------------------------------------------------------------------------
// Bit-extraction helpers (srid / type / z / m / ndims)
// ---------------------------------------------------------------------------

describe('bit helpers', () => {
  it('srid extracts the SRID from a mod value', () => {
    expect(postgis.srid(1107460)).toBe(4326);
    expect(postgis.srid(0)).toBe(0);
  });

  it('type extracts the geometry type index', () => {
    expect(postgis.type(0)).toBe(0);
    expect(postgis.type(4)).toBe(1);  // Point
    expect(postgis.type(8)).toBe(2);  // LineString
    expect(postgis.type(12)).toBe(3); // Polygon
  });

  it('z extracts the Z (has-elevation) flag', () => {
    expect(postgis.z(0)).toBe(0);
    expect(postgis.z(2)).toBe(1);
    expect(postgis.z(4)).toBe(0);
  });

  it('m extracts the M (has-measure) flag', () => {
    expect(postgis.m(0)).toBe(0);
    expect(postgis.m(1)).toBe(1);
    expect(postgis.m(2)).toBe(0);
  });

  it('ndims: 2 for plain 2D, 3 for Z or M, 4 for ZM', () => {
    expect(postgis.ndims(0)).toBe(2);
    expect(postgis.ndims(2)).toBe(3); // Z bit
    expect(postgis.ndims(1)).toBe(3); // M bit
    expect(postgis.ndims(3)).toBe(4); // Z+M bits
  });
});

// ---------------------------------------------------------------------------
// geometryTypes array
// ---------------------------------------------------------------------------

describe('geometryTypes', () => {
  it('is non-empty', () =>
    expect(postgis.geometryTypes.length).toBeGreaterThan(0));

  it('is indexed from 0 (Unknown) through the named types', () => {
    expect(postgis.geometryTypes[0]).toBe('Unknown');
    expect(postgis.geometryTypes[1]).toBe('Point');
    expect(postgis.geometryTypes[2]).toBe('LineString');
    expect(postgis.geometryTypes[3]).toBe('Polygon');
    expect(postgis.geometryTypes[7]).toBe('GeometryCollection');
  });

  it('contains all major geometry type names', () => {
    const required = [
      'Point', 'LineString', 'Polygon',
      'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection',
    ];
    for (const name of required) {
      expect(postgis.geometryTypes).toContain(name);
    }
  });
});
