-- Migration 0009: backfill display names for instruments whose broker
-- payload carries none (Kite get_holdings has no security name field).
-- Names come from the curated data/names.csv (user's own CAS statement).
-- Only fills EMPTY names - sharekhan/CAS names already present stay.
-- KEEP IN SYNC with data/names.csv (a ticker added there needs an UPDATE here
-- to reach the live DB; the code path only covers NEW rows after this runs).

UPDATE instrument SET name = 'ADANI POWER LIMITED' WHERE ticker = 'ADANIPOWER' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'AFFLE 3I LIMITED' WHERE ticker = 'AFFLE' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'APAR INDUSTRIES LIMITED' WHERE ticker = 'APARINDS' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'BAJAJ FINANCE LIMITED' WHERE ticker = 'BAJFINANCE' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'COMPUTER AGE MANAGEMENT SERVICES LIMITED' WHERE ticker = 'CAMS' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'CAPLIN POINT LABORATORIES LIMITED' WHERE ticker = 'CAPLIPOINT' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'CENTRAL DEPOSITORY SERVICES (INDIA) LIMITED' WHERE ticker = 'CDSL' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'CG POWER AND INDUSTRIAL SOLUTIONS LIMITED' WHERE ticker = 'CGPOWER' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'CMS INFO SYSTEMS LIMITED' WHERE ticker = 'CMSINFO' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'CUMMINS INDIA LIMITED' WHERE ticker = 'CUMMINSIND' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'DEEPAK NITRITE LTD' WHERE ticker = 'DEEPAKNTR' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'E I D PARRY (INDIA) LIMITED' WHERE ticker = 'EIDPARRY' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'ETERNAL LIMITED' WHERE ticker = 'ETERNAL' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'GODAWARI POWER AND ISPAT LIMITED' WHERE ticker = 'GPIL' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'HCL TECHNOLOGIES LIMITED' WHERE ticker = 'HCLTECH' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'HDFC BANK LIMITED' WHERE ticker = 'HDFCBANK' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'INFOSYS LIMITED' WHERE ticker = 'INFY' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'INOX INDIA LIMITED' WHERE ticker = 'INOXINDIA' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'ION EXCHANGE (INDIA) LIMITED' WHERE ticker = 'IONEXCHANG' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'INDIAN RAILWAY CATERING AND TOURISM CORPORATION LTD' WHERE ticker = 'IRCTC' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'INDIAN RENEWABLE ENERGY DEVELOPMENT AGENCY LIMITED' WHERE ticker = 'IREDA' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'INDIAN RAILWAY FINANCE CORPORATION LIMITED' WHERE ticker = 'IRFC' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'JIO FINANCIAL SERVICES LIMITED' WHERE ticker = 'JIOFIN' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'KPIT TECHNOLOGIES LIMITED' WHERE ticker = 'KPITTECH' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'LARSEN & TOUBRO LIMITED' WHERE ticker = 'LT' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'MOTILAL OSWAL NASDAQ 100 ETF' WHERE ticker = 'MON100' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'POWER FINANCE CORPORATION LIMITED' WHERE ticker = 'PFC' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'PRICOL LIMITED' WHERE ticker = 'PRICOLLTD' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'RAIL VIKAS NIGAM LIMITED' WHERE ticker = 'RVNL' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'SONA BLW PRECISION FORGINGS LIMITED' WHERE ticker = 'SONACOMS' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'SUPREME PETROCHEM LIMITED' WHERE ticker = 'SPLPETRO' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'THE SUPREME INDUSTRIES LIMITED' WHERE ticker = 'SUPREMEIND' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'WAAREE ENERGIES LIMITED' WHERE ticker = 'WAAREEENER' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'VA TECH WABAG LIMITED' WHERE ticker = 'WABAG' AND (name IS NULL OR name = '');
UPDATE instrument SET name = 'ZEN TECHNOLOGIES LIMITED' WHERE ticker = 'ZENTEC' AND (name IS NULL OR name = '');

PRAGMA user_version = 9;

