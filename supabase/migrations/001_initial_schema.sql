-- 001_initial_schema.sql
-- Quick Delivery Service Route Recommendation App for Seoul
-- Initial database schema

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- 1. dong_boundaries - Seoul administrative district polygons
-- ============================================================
CREATE TABLE dong_boundaries (
    dong_code   VARCHAR(10) PRIMARY KEY,
    dong_name   VARCHAR(50) NOT NULL,
    gu_name     VARCHAR(50) NOT NULL,
    boundary    GEOMETRY(MultiPolygon, 4326) NOT NULL,
    center_point GEOMETRY(Point, 4326) NOT NULL,
    area_km2    NUMERIC NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dong_boundaries_boundary ON dong_boundaries USING GIST (boundary);
CREATE INDEX idx_dong_boundaries_center_point ON dong_boundaries USING GIST (center_point);

-- ============================================================
-- 2. dong_adjacency - Pre-computed adjacency between districts
-- ============================================================
CREATE TABLE dong_adjacency (
    dong_code_1 VARCHAR(10) NOT NULL REFERENCES dong_boundaries(dong_code),
    dong_code_2 VARCHAR(10) NOT NULL REFERENCES dong_boundaries(dong_code),
    distance_km NUMERIC NOT NULL,
    PRIMARY KEY (dong_code_1, dong_code_2)
);

CREATE INDEX idx_dong_adjacency_code2 ON dong_adjacency (dong_code_2);

-- ============================================================
-- 3. dong_scores - Call expectation scores per district
-- ============================================================
CREATE TABLE dong_scores (
    dong_code           VARCHAR(10) PRIMARY KEY REFERENCES dong_boundaries(dong_code),
    logistics_count     INTEGER NOT NULL DEFAULT 0,
    office_count        INTEGER NOT NULL DEFAULT 0,
    hospital_count      INTEGER NOT NULL DEFAULT 0,
    shopping_count      INTEGER NOT NULL DEFAULT 0,
    general_store_count INTEGER NOT NULL DEFAULT 0,
    call_expectation    NUMERIC NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dong_scores_call_expectation ON dong_scores (call_expectation DESC);

-- ============================================================
-- 4. driver_locations - Real-time driver positions
--    Uses simple lat/lng columns for easy frontend/backend interop
-- ============================================================
CREATE TABLE driver_locations (
    driver_id        TEXT PRIMARY KEY,
    lat              NUMERIC NOT NULL,
    lng              NUMERIC NOT NULL,
    heading          NUMERIC,
    speed_kmh        NUMERIC,
    current_dong_code VARCHAR(10) REFERENCES dong_boundaries(dong_code),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_locations_dong_code ON driver_locations (current_dong_code);

-- ============================================================
-- 5. orders - Driver's current orders
-- ============================================================
CREATE TABLE orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id        TEXT NOT NULL,
    pickup_address   TEXT,
    pickup_location  GEOMETRY(Point, 4326),
    dropoff_address  TEXT,
    dropoff_location GEOMETRY(Point, 4326),
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'picked_up', 'in_transit', 'completed', 'cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_driver_id ON orders (driver_id);
CREATE INDEX idx_orders_pickup_location ON orders USING GIST (pickup_location);
CREATE INDEX idx_orders_dropoff_location ON orders USING GIST (dropoff_location);

-- ============================================================
-- Row Level Security
-- ============================================================

-- driver_locations: open for now (auth to be added later)
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_locations_all ON driver_locations
    FOR ALL USING (true) WITH CHECK (true);

-- orders: open for now (auth to be added later)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_all ON orders
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Functions
-- ============================================================

-- calculate_dong_scores: computes call_expectation using weighted sum, normalized to 0-100
CREATE OR REPLACE FUNCTION calculate_dong_scores()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    max_raw NUMERIC;
BEGIN
    -- Compute raw weighted scores
    UPDATE dong_scores
    SET call_expectation = (
        logistics_count     * 5.0 +
        office_count        * 4.0 +
        hospital_count      * 3.5 +
        shopping_count      * 3.0 +
        general_store_count * 1.0
    ),
    updated_at = now();

    -- Find the maximum raw score for normalization
    SELECT MAX(call_expectation) INTO max_raw FROM dong_scores;

    -- Normalize to 0-100 range
    IF max_raw IS NOT NULL AND max_raw > 0 THEN
        UPDATE dong_scores
        SET call_expectation = ROUND((call_expectation / max_raw) * 100, 2),
            updated_at = now();
    END IF;
END;
$$;

-- find_current_dong: returns the dong_code containing the given lat/lng point
CREATE OR REPLACE FUNCTION find_current_dong(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS VARCHAR(10)
LANGUAGE sql
STABLE
AS $$
    SELECT dong_code
    FROM dong_boundaries
    WHERE ST_Contains(boundary, ST_SetSRID(ST_Point(p_lng, p_lat), 4326))
    LIMIT 1;
$$;

-- find_nearby_hot_dongs: find high-score dongs near a route line
CREATE OR REPLACE FUNCTION find_nearby_hot_dongs(
    route_line_wkt TEXT,
    buffer_metres INTEGER DEFAULT 3000,
    min_score NUMERIC DEFAULT 20
)
RETURNS TABLE (
    dong_code VARCHAR(10),
    dong_name VARCHAR(50),
    center_lat DOUBLE PRECISION,
    center_lng DOUBLE PRECISION,
    call_expectation NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        db.dong_code,
        db.dong_name,
        ST_Y(db.center_point) AS center_lat,
        ST_X(db.center_point) AS center_lng,
        ds.call_expectation
    FROM dong_boundaries db
    JOIN dong_scores ds ON ds.dong_code = db.dong_code
    WHERE ds.call_expectation >= min_score
      AND ST_DWithin(
            db.center_point::geography,
            ST_GeomFromText(route_line_wkt, 4326)::geography,
            buffer_metres
          )
    ORDER BY ds.call_expectation DESC;
$$;

-- ============================================================
-- Trigger: auto-set current_dong_code on driver_locations upsert
-- ============================================================
CREATE OR REPLACE FUNCTION set_driver_current_dong()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
        NEW.current_dong_code := find_current_dong(NEW.lat, NEW.lng);
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_driver_locations_set_dong
    BEFORE INSERT OR UPDATE ON driver_locations
    FOR EACH ROW
    EXECUTE FUNCTION set_driver_current_dong();
