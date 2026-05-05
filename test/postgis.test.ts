/// <reference types="jest" />

import { Pool } from 'pg';
import wkx from 'wkx';
import postgis, { type ExecFn } from '../src/index';

const CONNECTION =
  process.env.DATABASE_URL ?? 'postgresql://postgres@localhost/pg_custom_types';

const pool = new Pool({ connectionString: CONNECTION });

const exec: ExecFn = (sql, callback) => {
  pool
    .query(sql)
    .then((result) => callback(null, result))
    .catch((err: unknown) =>
      callback(err instanceof Error ? err : new Error(JSON.stringify(err))),
    );
};

beforeAll(async () => {
  await postgis(exec, null);
});

afterAll(async () => {
  await pool.end();
});

describe('postgis types', () => {
  it('parses postgis geometries', async () => {
    const results = await pool.query<{ geom: { toGeoJSON(): unknown } }>(
      "SELECT ST_GeomFromText('POINT(1 2)') AS geom",
    );
    expect(results.rows[0].geom.toGeoJSON()).toEqual({
      type: 'Point',
      coordinates: [1, 2],
    });
  });

  it('parses postgis geographies', async () => {
    const results = await pool.query<{ geom: { toGeoJSON(): unknown } }>(
      "SELECT ST_GeographyFromText('SRID=4326;POINT(-110 30)') AS geom",
    );
    expect(results.rows[0].geom.toGeoJSON()).toEqual({
      type: 'Point',
      coordinates: [-110, 30],
    });
  });

  it('parses postgis box2d', async () => {
    const results = await pool.query(
      "SELECT Box2D(ST_GeomFromText('LINESTRING(1 2, 3 4, 5 6)')) AS geom",
    );
    expect(results.rows[0].geom).toEqual([
      [1, 2],
      [5, 6],
    ]);
  });

  it('converts type names to oids', () => {
    expect(postgis.getTypeName(postgis.getTypeOID('geometry', null), null)).toBe('geometry');
  });

  it('produces the full type name from typmods', async () => {
    const results = await pool.query('SELECT geom FROM test');
    expect(postgis.typename(results.fields[0].dataTypeModifier)).toBe('(Point,4326)');
  });

  it('produces an empty type name from typmods', async () => {
    const results = await pool.query(
      "SELECT ST_GeomFromText('LINESTRING(1 2, 3 4, 5 6)', 4326)",
    );
    expect(postgis.typename(results.fields[0].dataTypeModifier)).toBe('');
  });

  it('detects geometry array types', async () => {
    const results = await pool.query(
      "SELECT ARRAY[ST_GeomFromText('POINT(1 1)'), ST_GeomFromText('POINT(1 1)')]",
    );
    expect(postgis.isGeometryType(results.fields[0].dataTypeID, null)).toBe(true);
  });

  // Adversarial / bounds tests
  it('handles null oid in isGeometryType gracefully', () => {
    expect(postgis.isGeometryType(0, null)).toBe(false);
    expect(postgis.isGeometryType(-1, null)).toBe(false);
  });

  it('returns undefined for unknown oid in getTypeParser', () => {
    expect(postgis.getTypeParser(0, null)).toBeUndefined();
  });

  it('typename returns empty string for mod < 0', () => {
    expect(postgis.typename(-1)).toBe('');
  });

  it('typename returns empty string for zero mod', () => {
    expect(postgis.typename(0)).toBe('');
  });

  it('typeobj returns correct structure', () => {
    const obj = postgis.typeobj(0);
    expect(obj).toHaveProperty('type');
    expect(obj).toHaveProperty('srid');
    expect(obj).toHaveProperty('z');
    expect(obj).toHaveProperty('m');
    expect(obj).toHaveProperty('ndims');
  });

  it('geometryTypes contains expected type names', () => {
    expect(postgis.geometryTypes).toContain('Point');
    expect(postgis.geometryTypes).toContain('Polygon');
    expect(postgis.geometryTypes).toContain('GeometryCollection');
  });

  it('setGeometryParser allows overriding the parser', async () => {
    const sentinel = Symbol('sentinel');
    postgis.setGeometryParser(() => sentinel);

    const results = await pool.query<{ geom: unknown }>(
      "SELECT ST_GeomFromText('POINT(1 2)') AS geom",
    );
    expect(results.rows[0].geom).toBe(sentinel);

    // Restore default parser so subsequent tests are unaffected
    postgis.setGeometryParser((value: string) =>
      wkx.Geometry.parse(Buffer.from(value, 'hex')),
    );
  });
});
