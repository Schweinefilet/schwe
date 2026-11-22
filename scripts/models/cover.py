#!/usr/bin/env python3
"""What covers a city's open ground, for the photoreal New York's ground (scripts/models/cover.mjs turns it
into public/models/<city>-cover.png). From Overture Maps' public GeoParquet, OSM-derived (© OpenStreetMap
contributors and Overture Maps Foundation, ODbL):

  data/models/<city>-cover.json   polygons with a kind: 'park' (land_use: parks, gardens, playgrounds,
                                  pitches, cemeteries, golf), 'grass' (land: grass, meadow, scrub),
                                  'trees' (land: forest, wood, tree rows)

Gitignored, like fetch.py's output. Needs duckdb.

  python3 scripts/models/cover.py --city new-york [--release 2026-10-21.0]
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
    prefix = f'release/{args.release}/theme={theme}/type={kind}/'
    xml = urllib.request.urlopen(f'{BUCKET}/?list-type=2&prefix={prefix}').read().decode()
    keys = re.findall(r'<Key>([^<]+\.parquet)</Key>', xml)
    return '[' + ', '.join(f"'{BUCKET}/{k}'" for k in keys) + ']'


box = f'bbox.xmin < {xmax} AND bbox.xmax > {xmin} AND bbox.ymin < {ymax} AND bbox.ymax > {ymin}'
polys = "ST_GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON')"


def rows(sql, kind_of):
    out = []
    for subtype, cls, geometry in con.execute(sql).fetchall():
        kind = kind_of(subtype, cls)
        if kind:
            out.append({'kind': kind, 'subtype': subtype, 'class': cls, 'geometry': json.loads(geometry)})
    return out


PARK = {'park', 'garden', 'playground', 'pitch', 'village_green', 'recreation_ground', 'dog_park', 'cemetery', 'grave_yard',
        'golf_course', 'grass', 'meadow', 'common', 'nature_reserve', 'allotments', 'greenfield', 'flowerbed'}


def land_use(subtype, cls):
    if cls in PARK or subtype in ('park', 'golf', 'cemetery'):
        return 'park'
    return None


def land(subtype, cls):
    if subtype in ('forest',) or cls in ('wood', 'forest', 'tree_row', 'tree'):
        return 'trees'
    if subtype in ('grass', 'shrub', 'wetland') or cls in ('grass', 'grassland', 'meadow', 'scrub', 'heath'):
        return 'grass'
    return None


cover = rows(f"""SELECT subtype, class, ST_AsGeoJSON(geometry) FROM read_parquet({files('base', 'land_use')})
                 WHERE {box} AND {polys}""", land_use)
cover += rows(f"""SELECT subtype, class, ST_AsGeoJSON(geometry) FROM read_parquet({files('base', 'land')})
                  WHERE {box} AND {polys}""", land)
out = os.path.join(here, '..', '..', 'data', 'models')
os.makedirs(out, exist_ok=True)
json.dump(cover, open(os.path.join(out, f'{args.city}-cover.json'), 'w'))
counts = {}
for c in cover:
    counts[c['kind']] = counts.get(c['kind'], 0) + 1
print(f'{args.city}: {len(cover)} cover polygons', counts)
