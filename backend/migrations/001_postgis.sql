-- SafeRoute AI — PostgreSQL / PostGIS additions.
--
-- The base schema (tables, foreign keys, b-tree indexes) is created from the SQLAlchemy
-- models in app/models.py on startup (`Base.metadata.create_all`). Run this file once
-- after the first `python -m app.seed` when using PostgreSQL to add spatial columns,
-- spatial indexes and a least-privilege application role.
--
--   psql "$DATABASE_URL" -f migrations/001_postgis.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- Point geometry for incidents and reports, kept in sync with latitude/longitude.
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
CREATE INDEX IF NOT EXISTS ix_incidents_geom ON incidents USING GIST (geom);

ALTER TABLE hazard_reports
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
CREATE INDEX IF NOT EXISTS ix_hazard_reports_geom ON hazard_reports USING GIST (geom);

ALTER TABLE path_nodes
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
CREATE INDEX IF NOT EXISTS ix_path_nodes_geom ON path_nodes USING GIST (geom);

-- Path edges store their polyline as JSON [[lat, lon], ...]; materialise a LineString.
ALTER TABLE path_edges ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);
UPDATE path_edges e
SET geom = sub.line
FROM (
  SELECT id,
         ST_SetSRID(ST_MakeLine(ARRAY(
           SELECT ST_MakePoint((pt ->> 1)::float8, (pt ->> 0)::float8)
           FROM json_array_elements(geometry::json) WITH ORDINALITY AS t(pt, ord)
           ORDER BY ord)), 4326) AS line
  FROM path_edges
) sub
WHERE e.id = sub.id AND e.geom IS NULL;
CREATE INDEX IF NOT EXISTS ix_path_edges_geom ON path_edges USING GIST (geom);

-- Least-privilege role for the API process. Role-based permissions (student / operator /
-- maintenance) are enforced in the API layer; the database role only limits what the
-- service can do (no DDL, no access to other schemas).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saferoute_app') THEN
    CREATE ROLE saferoute_app LOGIN PASSWORD 'change-me';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO saferoute_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO saferoute_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO saferoute_app;
-- Audit trail is append-only for the app role.
REVOKE UPDATE, DELETE ON incident_history FROM saferoute_app;
