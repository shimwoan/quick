-- Add new facility categories to dong_scores
ALTER TABLE dong_scores ADD COLUMN IF NOT EXISTS legal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dong_scores ADD COLUMN IF NOT EXISTS wholesale_market_count INTEGER NOT NULL DEFAULT 0;

-- Update calculate_dong_scores with corrected weights
-- Office 5.0 (was 4.0) - primary demand driver
-- Hospital 4.5 (was 3.5) - high frequency
-- Legal/Courts 5.0 (new) - highest per-capita users
-- Wholesale 3.5 (new) - undercounted heavy users
-- Logistics 2.5 (was 5.0) - major centers use own fleets
-- Shopping 1.5 (was 3.0) - mostly food delivery, not quick
-- General 1.0 (unchanged)

CREATE OR REPLACE FUNCTION calculate_dong_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    max_raw NUMERIC;
BEGIN
    UPDATE dong_scores
    SET call_expectation = (
        office_count            * 5.0 +
        legal_count             * 5.0 +
        hospital_count          * 4.5 +
        wholesale_market_count  * 3.5 +
        logistics_count         * 2.5 +
        shopping_count          * 1.5 +
        general_store_count     * 1.0
    ),
    updated_at = now()
    WHERE dong_code IS NOT NULL;

    SELECT MAX(call_expectation) INTO max_raw FROM dong_scores;

    IF max_raw IS NOT NULL AND max_raw > 0 THEN
        UPDATE dong_scores
        SET call_expectation = ROUND((call_expectation / max_raw) * 100, 2),
            updated_at = now()
        WHERE dong_code IS NOT NULL;
    END IF;
END;
$$;
