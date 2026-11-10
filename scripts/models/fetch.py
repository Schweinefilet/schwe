#!/usr/bin/env python3
"""Fetches what scripts/models/build.mjs raises into a city's maquette, from Overture Maps' public
GeoParquet on S3 (buildings and building parts with heights and roof shapes: © OpenStreetMap contributors
and Overture Maps Foundation, ODbL; water: © OpenStreetMap contributors, ODbL):

  data/models/<city>-buildings.json   footprints (GeoJSON geometry) with height, floors, roof shape
  data/models/<city>-water.json       water polygons
  data/models/<city>-infra.json       bridge and pier outlines (polygons)

Both gitignored. Needs duckdb (pip install duckdb). Overpass, which scripts/skyline/ used, is not always
reachable; Overture's bucket is plain HTTPS.

  python3 scripts/models/fetch.py --city new-york [--release 2026-10-21.0]
"""

import argparse
import json
import math
import os
import re
import urllib.request

import duckdb

ap = argparse.ArgumentParser()
ap.add_argument('--city', required=True)
ap.add_argument('--release', default='2026-10-21.0')
args = ap.parse_args()

here = os.path.dirname(__file__)
spec = json.load(open(os.path.join(here, '..', '..', 'src', 'content', 'models.json')))[args.city]
lat0, lon0 = spec['center']
# The plinth's rectangle, turned to the city's axis: fetch its bounding box (build.mjs clips to the rectangle).
b = math.radians(spec['axisBearing'])
L, W = spec['halfLength'], spec['halfWidth']
ex = abs(L * math.sin(b)) + abs(W * math.cos(b)) + 150
ny = abs(L * math.cos(b)) + abs(W * math.sin(b)) + 150
dlat = ny / 110540
dlon = ex / (111320 * math.cos(math.radians(lat0)))
xmin, xmax, ymin, ymax = lon0 - dlon, lon0 + dlon, lat0 - dlat, lat0 + dlat

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;')
proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
if proxy:
    con.execute(f"SET http_proxy='{proxy.split('://')[-1]}'")
BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com'


def files(theme, kind):
    """The release's parquet files for one type, as HTTPS URLs (anonymous: no S3 credentials involved)."""
    prefix = f'release/{args.release}/theme={theme}/type={kind}/'
    xml = urllib.request.urlopen(f'{BUCKET}/?list-type=2&prefix={prefix}').read().decode()
    keys = re.findall(r'<Key>([^<]+\.parquet)</Key>', xml)
    return '[' + ', '.join(f"'{BUCKET}/{k}'" for k in keys) + ']'


box = f'bbox.xmin < {xmax} AND bbox.xmax > {xmin} AND bbox.ymin < {ymax} AND bbox.ymax > {ymin}'
out = os.path.join(here, '..', '..', 'data', 'models')
os.makedirs(out, exist_ok=True)


def rows(sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        d['geometry'] = json.loads(d['geometry'])
        yield {k: v for k, v in d.items() if v is not None}


buildings = []
for kind in ('building', 'building_part'):
    extra = 'has_parts, NULL AS building_id' if kind == 'building' else 'NULL AS has_parts, building_id'
    buildings += [dict(r, kind=kind) for r in rows(f"""
        SELECT id, names.primary AS name, height, num_floors, min_height, min_floor, roof_shape, roof_height,
               roof_direction, roof_orientation, {extra}, ST_AsGeoJSON(geometry) AS geometry
        FROM read_parquet({files('buildings', kind)})
        WHERE {box}""")]
json.dump(buildings, open(os.path.join(out, f'{args.city}-buildings.json'), 'w'))
print(f'{args.city}: {len(buildings)} buildings and parts')

water = list(rows(f"""
    SELECT id, subtype, class, ST_AsGeoJSON(geometry) AS geometry
    FROM read_parquet({files('base', 'water')})
    WHERE {box} AND ST_GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON')"""))
json.dump(water, open(os.path.join(out, f'{args.city}-water.json'), 'w'))
print(f'{args.city}: {len(water)} water polygons')

infra = list(rows(f"""
    SELECT id, subtype, class, names.primary AS name, ST_AsGeoJSON(geometry) AS geometry
    FROM read_parquet({files('base', 'infrastructure')})
    WHERE {box} AND subtype IN ('bridge', 'pier') AND ST_GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON')"""))
json.dump(infra, open(os.path.join(out, f'{args.city}-infra.json'), 'w'))
print(f'{args.city}: {len(infra)} bridge and pier outlines')
