-- Edit bill orderdate (backdate)
-- Usage: replace <billid> and the timestamp as needed.
-- Timestamp format: 'YYYY-MM-DD HH:MM:SS+05:30' (IST)

UPDATE bills
SET orderdate = ('2026-04-01 10:30:00+05:30')::timestamptz AT TIME ZONE 'UTC'
WHERE billid = <billid>;

-- Backdate by bill_number
-- UPDATE bills
-- SET orderdate = ('2026-04-01 10:30:00+05:30')::timestamptz AT TIME ZONE 'UTC'
-- WHERE bill_number = 'BC26-001';

-- Bulk backdate a range of bills
-- UPDATE bills
-- SET orderdate = ('2026-04-01 10:30:00+05:30')::timestamptz AT TIME ZONE 'UTC'
-- WHERE billid IN (1, 2, 3);
