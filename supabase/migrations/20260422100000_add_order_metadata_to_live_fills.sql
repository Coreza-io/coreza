ALTER TABLE live_fills ADD COLUMN order_type text;
ALTER TABLE live_fills ADD COLUMN limit_price numeric;
ALTER TABLE live_fills ADD COLUMN stop_price numeric;
ALTER TABLE live_fills ADD COLUMN tag text;
