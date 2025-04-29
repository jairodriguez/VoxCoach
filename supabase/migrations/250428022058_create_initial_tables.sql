-- enable pgvector
create extension if not exists "vector";

-- fix RLS helper to get tenant_id from JWT claims
create or replace function current_tenant() returns text language sql stable as $$
  select current_setting('request.jwt.claims', true)::json ->> 'tenant_id';
$$;

-- Create tenants table
create table tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  name text not null,
  branding_json jsonb,
  pricing_model text,
  stripe_account_id text,
  cert_template text
);
alter table tenants enable row level security;
-- Policy using the helper function
create policy "Tenant isolation" on tenants
for all using (current_tenant() = id::text);

-- Create users table
create table users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  tenant_id uuid references tenants(id) on delete cascade on update cascade,
  auth_id uuid unique default auth.uid(),
  role text,
  email text unique -- Supabase Auth enforces unique email; keeping for clarity but not strictly necessary if relying solely on auth.uid()
);
alter table users enable row level security;
-- Policy using the helper function
create policy "Allow all for tenant members" on users
for all using (current_tenant() = tenant_id::text);

-- Create phases table
create table phases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  tenant_id uuid references tenants(id) on delete cascade on update cascade,
  "order" int,
  name text not null,
  price_id text,
  unique (tenant_id, "order") -- Composite unique constraint
);
alter table phases enable row level security;
-- Policy using the helper function
create policy "Allow all for tenant members" on phases
for all using (current_tenant() = tenant_id::text);

-- Create quizzes table
create table quizzes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  tenant_id uuid references tenants(id) on delete cascade on update cascade,
  phase_id uuid references phases(id) on delete cascade on update cascade,
  mode text,
  question_json jsonb
);
alter table quizzes enable row level security;
-- Policy using the helper function
create policy "Allow all for tenant members" on quizzes
for all using (current_tenant() = tenant_id::text);

-- Create sessions table
create table sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  user_id uuid references users(id) on delete cascade on update cascade,
  phase_id uuid references phases(id) on delete cascade on update cascade,
  metadata_json jsonb
);
alter table sessions enable row level security;
-- Policy using the helper function (references user's tenant_id)
create policy "Allow all for tenant members" on sessions
for all using (current_tenant() = (select tenant_id from users where id = user_id limit 1)::text);

-- Create documents table
create table documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  user_id uuid references users(id) on delete cascade on update cascade,
  phase_id uuid references phases(id) on delete cascade on update cascade,
  url text not null,
  type text
);
alter table documents enable row level security;
-- Policy using the helper function (references user's tenant_id)
create policy "Allow all for tenant members" on documents
for all using (current_tenant() = (select tenant_id from users where id = user_id limit 1)::text);

-- Create certificates table
create table certificates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  user_id uuid references users(id) on delete cascade on update cascade,
  phase_id uuid references phases(id) on delete cascade on update cascade,
  cert_id text unique not null,
  url text,
  issued_at timestamp with time zone default null -- Default to null, set when issued
);
alter table certificates enable row level security;
-- Policy using the helper function (references user's tenant_id)
create policy "Allow all for tenant members" on certificates
for all using (current_tenant() = (select tenant_id from users where id = user_id limit 1)::text);

-- Create resources table (for KB vectors)
create table resources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  tenant_id uuid references tenants(id) on delete cascade on update cascade,
  file_url text not null,
  embedding vector(1536) -- OpenAI text-embedding-ada-002 dimension
);
alter table resources enable row level security;
-- Policy using the helper function
create policy "Allow all for tenant members" on resources
for all using (current_tenant() = tenant_id::text);

-- Create xp_log table
create table xp_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  user_id uuid references users(id) on delete cascade on update cascade,
  event_type text,
  points smallint, -- Changed to smallint
  metadata_json jsonb
);
alter table xp_log enable row level security;
-- Policy using the helper function (references user's tenant_id)
create policy "Allow all for tenant members" on xp_log
for all using (current_tenant() = (select tenant_id from users where id = user_id limit 1)::text);

-- Create tenant_stats table
create table tenant_stats (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  tenant_id uuid references tenants(id) on delete cascade on update cascade,
  date date not null,
  tokens_used bigint default 0,
  storage_used_bytes bigint default 0,
  revenue numeric default 0,
  metadata_json jsonb,
  unique (tenant_id, date) -- Composite unique constraint
);
alter table tenant_stats enable row level security;
-- Policy using the helper function
create policy "Allow all for tenant members" on tenant_stats
for all using (current_tenant() = tenant_id::text);

-- Create payments table
create table payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  tenant_id uuid references tenants(id) on delete cascade on update cascade,
  stripe_checkout_session_id text unique,
  amount numeric not null,
  currency text not null,
  status text check (status in ('pending','succeeded','failed')) default 'pending', -- Added check constraint
  metadata_json jsonb
);
alter table payments enable row level security;
-- Policy using the helper function
create policy "Allow all for tenant members" on payments
for all using (current_tenant() = tenant_id::text);