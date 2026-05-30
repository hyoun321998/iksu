// ─────────────────────────────────────────────────────────────────────────────
//  IKSU CONFIG — fill in both sections below before going live
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. SUPABASE ──────────────────────────────────────────────────────────────
//  a) Go to https://supabase.com → create a free account & project
//  b) Open the SQL Editor and run:
//
//     create table expressions_of_interest (
//       id uuid default uuid_generate_v4() primary key,
//       kick_user_id text unique not null,
//       kick_username text not null,
//       kick_display_name text,
//       kick_profile_pic text,
//       kick_slug text,
//       follower_count integer default 0,
//       created_at timestamp with time zone default now()
//     );
//     alter table expressions_of_interest enable row level security;
//     create policy "public read"   on expressions_of_interest for select using (true);
//     create policy "public insert" on expressions_of_interest for insert with check (true);
//
//  c) Project Settings → API → copy Project URL and anon/public key below

const SUPABASE_URL      = 'https://ctudfgansmyqkssectjl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Y1VsF-GoGnPUDuoFN_dElw_9L__-v0g';


// ── 2. KICK OAUTH ─────────────────────────────────────────────────────────────
//  a) Go to https://kick.com/settings/developer-apps → create a new app
//  b) Set the Redirect URI to:  https://your-domain.com/callback.html
//     (must exactly match — use http://localhost:PORT/callback.html for local testing)
//  c) Copy the Client ID below. Do NOT paste the Client Secret here — the PKCE
//     flow used by this site does not require it and it must stay private.

const KICK_CLIENT_ID        = '01KSSTC3QYYM2XK98N4FS6QZ1H';
const KICK_REDIRECT_URI     = 'https://iksu.org/callback.html';
const KICK_TOKEN_WORKER_URL = 'https://iksu-auth.hyoun321998.workers.dev';
