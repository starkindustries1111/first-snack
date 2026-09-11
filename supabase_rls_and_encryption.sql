-- =========================================================================
-- Snaxify Database Security: Enable Row Level Security (RLS) & Encryption
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- =========================================================================

-- 1. Enable pgcrypto extension for data encryption & decryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. ENABLE ROW LEVEL SECURITY (RLS) ON ORDERS TABLE
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;

-- Allow public / anon users to INSERT orders (needed during checkout)
DROP POLICY IF EXISTS "Allow anonymous insert orders" ON orders;
CREATE POLICY "Allow anonymous insert orders" 
  ON orders 
  FOR INSERT 
  TO anon, authenticated 
  WITH CHECK (true);

-- Deny public / anon users from SELECTING orders
-- Only backend service_role key can read all customer orders
DROP POLICY IF EXISTS "Allow service_role full access on orders" ON orders;
CREATE POLICY "Allow service_role full access on orders" 
  ON orders 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

-- 3. ENABLE ROW LEVEL SECURITY (RLS) ON COUPONS TABLE
ALTER TABLE IF EXISTS coupons ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to READ ONLY active coupons
DROP POLICY IF EXISTS "Allow public read active coupons" ON coupons;
CREATE POLICY "Allow public read active coupons" 
  ON coupons 
  FOR SELECT 
  TO anon, authenticated 
  USING (enabled = true);

-- Allow service_role key full CRUD on coupons
DROP POLICY IF EXISTS "Allow service_role full access on coupons" ON coupons;
CREATE POLICY "Allow service_role full access on coupons" 
  ON coupons 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

-- 4. ENCRYPT SENSITIVE DATA (Column Level Encryption Example)
-- If encrypting sensitive customer data (such as contact, notes, or payment ref):
-- UPDATE orders SET customer_name = pgp_sym_encrypt(customer_name, 'your-secure-encryption-key');
-- SELECT pgp_sym_decrypt(customer_name::bytea, 'your-secure-encryption-key') AS decrypted_name FROM orders;
