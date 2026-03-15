-- Disable RLS on all tables
ALTER TABLE driver_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE dong_boundaries DISABLE ROW LEVEL SECURITY;
ALTER TABLE dong_scores DISABLE ROW LEVEL SECURITY;
ALTER TABLE dong_adjacency DISABLE ROW LEVEL SECURITY;

-- Drop RLS policies
DROP POLICY IF EXISTS driver_locations_select ON driver_locations;
DROP POLICY IF EXISTS driver_locations_insert ON driver_locations;
DROP POLICY IF EXISTS driver_locations_update ON driver_locations;
DROP POLICY IF EXISTS driver_locations_delete ON driver_locations;
DROP POLICY IF EXISTS orders_select ON orders;
DROP POLICY IF EXISTS orders_insert ON orders;
DROP POLICY IF EXISTS orders_update ON orders;
DROP POLICY IF EXISTS orders_delete ON orders;

-- Fix calculate_dong_scores to work with Supabase's safe UPDATE requirement
-- Use a CTE approach with explicit WHERE clause
CREATE OR REPLACE FUNCTION calculate_dong_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    max_raw NUMERIC;
BEGIN
    -- Compute raw weighted scores (with WHERE clause to satisfy Supabase)
    UPDATE dong_scores
    SET call_expectation = (
        logistics_count     * 5.0 +
        office_count        * 4.0 +
        hospital_count      * 3.5 +
        shopping_count      * 3.0 +
        general_store_count * 1.0
    ),
    updated_at = now()
    WHERE dong_code IS NOT NULL;

    -- Find the maximum raw score for normalization
    SELECT MAX(call_expectation) INTO max_raw FROM dong_scores;

    -- Normalize to 0-100 range
    IF max_raw IS NOT NULL AND max_raw > 0 THEN
        UPDATE dong_scores
        SET call_expectation = ROUND((call_expectation / max_raw) * 100, 2),
            updated_at = now()
        WHERE dong_code IS NOT NULL;
    END IF;
END;
$$;

-- Now run the score calculation
SELECT calculate_dong_scores();
