#!/usr/bin/env python3
"""The country round the photoreal New York's plinth: New Jersey's waterfront, Brooklyn, Queens, the rest
of Manhattan, from Overture Maps' public GeoParquet (OSM-derived: © OpenStreetMap contributors and
Overture Maps Foundation, ODbL). scripts/models/context.mjs turns it into
public/models/<city>-context.png (and -context.bin).

  data/models/<city>-context-water.json       water polygons in the box
  data/models/<city>-context-buildings.json   building footprints in the box: [height | null, floors | null, rings]
  data/models/<city>-context-green.json       parks and grass in the box

Gitignored. Needs duckdb.

  python3 scripts/models/context.py --city new-york [--release 2026-10-21.0]
"""

import argparse
import json
import os
import re
import urllib.request

import duckdb

ap = argparse.ArgumentParser()
ap.add_argument('--city', required=True)
ap.add_argument('--release', default='2026-10-21.0')
args = ap.parse_args()

# The box the site's views can see (src/city/cities.js: from the south-west, up to about 26 km from the
# camera), generously: lon/lat.
# Paris: from over Saint-Cloud east-north-east past the Eiffel Tower to Montreuil (cities.js).
BOXES = {'new-york': (-74.13, 40.62, -73.84, 40.87), 'paris': (2.17, 48.80, 2.53, 48.95)}
xmin, ymin, xmax, ymax = BOXES[args.city]

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
out = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'models')
os.makedirs(out, exist_ok=True)

water = [{'subtype': s, 'class': c, 'geometry': json.loads(g)} for s, c, g in con.execute(f"""
    SELECT subtype, class, ST_AsGeoJSON(geometry) FROM read_parquet({files('base', 'water')})
    WHERE {box} AND {polys}""").fetchall()]
json.dump(water, open(os.path.join(out, f'{args.city}-context-water.json'), 'w'))
print(f'{args.city}: {len(water)} water polygons')

green = [{'subtype': s, 'class': c, 'geometry': json.loads(g)} for s, c, g in con.execute(f"""
    SELECT subtype, class, ST_AsGeoJSON(geometry) FROM read_parquet({files('base', 'land_use')})
    WHERE {box} AND {polys} AND (subtype IN ('park', 'golf', 'cemetery') OR class IN ('park', 'garden', 'grass', 'pitch', 'cemetery', 'golf_course', 'recreation_ground', 'playground'))""").fetchall()]
json.dump(green, open(os.path.join(out, f'{args.city}-context-green.json'), 'w'))
print(f'{args.city}: {len(green)} green polygons')

rows = con.execute(f"""
    SELECT height, num_floors, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, 0.00001))
    FROM read_parquet({files('buildings', 'building')})
    WHERE {box} AND {polys}""").fetchall()
buildings = [[h, f, json.loads(g)['coordinates']] for h, f, g in rows]
json.dump(buildings, open(os.path.join(out, f'{args.city}-context-buildings.json'), 'w'))
print(f'{args.city}: {len(buildings)} buildings')
