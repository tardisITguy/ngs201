import {describe,expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';

function sourceFiles(directory:URL):URL[]{
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const child=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
  return entry.isDirectory()?sourceFiles(child):/\.(?:ts|tsx)$/.test(entry.name)?[child]:[];
 });
}

describe('Supabase platform foundation',()=>{
 it('keeps Supabase imports inside platform client infrastructure',()=>{
  const src=new URL('../src/',import.meta.url);
  const importers=sourceFiles(src).flatMap(file=>
   readFileSync(file,'utf8').includes('@supabase/supabase-js')?[file.pathname.replaceAll('\\','/')]:[]
  );
  expect(importers.length).toBeGreaterThanOrEqual(3);
  expect(importers.every(path=>path.includes('/src/platform/'))).toBe(true);
  expect(importers.some(path=>path.endsWith('/src/platform/supabase/client.ts'))).toBe(true);
 });

 it('uses only browser-safe Supabase environment names in browser source',()=>{
  const sources=sourceFiles(new URL('../src/',import.meta.url)).map(file=>readFileSync(file,'utf8')).join('\n');
  expect(sources).not.toMatch(/SUPABASE_(?:SERVICE_ROLE|SECRET|DB_PASSWORD|DATABASE_PASSWORD)|service_role/i);
  const client=readFileSync(new URL('../src/platform/supabase/client.ts',import.meta.url),'utf8');
  expect(client).toContain('VITE_SUPABASE_URL');
  expect(client).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
 });

 it('ignores local environment files while retaining the placeholder example',()=>{
  const ignore=readFileSync(new URL('../.gitignore',import.meta.url),'utf8');
  expect(ignore).toMatch(/^\.env$/m);
  expect(ignore).toMatch(/^\.env\.\*$/m);
  expect(ignore).toMatch(/^!\.env\.example$/m);
  const example=readFileSync(new URL('../.env.example',import.meta.url),'utf8');
  expect(example).toBe('VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\n');
 });

 it('grants browser roles read-only access and enables RLS',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
  for(const table of ['games','rooms','room_players']){
   expect(migration).toContain(`alter table public.${table} enable row level security`);
   expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
   expect(migration).toContain(`grant select on table public.${table} to authenticated`);
  }
  expect(migration).not.toMatch(/grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.(?:rooms|room_players)/i);
 });

 it('keeps canonical room state server-only with explicit service privileges',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
  const rooms=migration.match(/create table public\.rooms \([\s\S]*?\n\);/)?.[0]??'';
  expect(rooms).not.toMatch(/game_state|state_version/);
  expect(migration).toContain('create table public.room_states');
  expect(migration).toContain('alter table public.room_states enable row level security');
  expect(migration).toContain('revoke all on table public.room_states from public, anon, authenticated');
  expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete|all)[^;]*public\.room_states\s+to\s+(?:anon|authenticated)/i);
  expect(migration).not.toMatch(/create policy[^;]*\bon public\.room_states\b/i);
  for(const table of ['games','rooms','room_players','room_states']){
   expect(migration).toContain(`revoke all on table public.${table} from service_role`);
  }
  expect(migration).toContain('grant select on table public.games to service_role');
  for(const table of ['rooms','room_players','room_states']){
   expect(migration).toContain(`grant select, insert, update, delete on table public.${table} to service_role`);
  }
  expect(migration).not.toMatch(/grant\s+(?:truncate|references|trigger)[^;]*to service_role/i);
 });

 it('models unique lobby colors and trusted persisted turn order without seats',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
  const players=migration.match(/create table public\.room_players \([\s\S]*?\n\);/)?.[0]??'';
  expect(players).not.toMatch(/\bseat\b/);
  expect(players).toContain('turn_order smallint');
  expect(migration).toMatch(/create unique index room_players_room_turn_order_uidx\s+on public\.room_players\(room_id, turn_order\)\s+where turn_order is not null;/);
  expect(migration).toMatch(/create unique index room_players_room_color_uidx\s+on public\.room_players\(room_id, player_color\)\s+where player_color is not null;/);
 });

 it('contains no development Undo surface',()=>{
  const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  const sidebar=readFileSync(new URL('../src/games/worship-me/ui/renderSidebar.ts',import.meta.url),'utf8');
  expect(`${main}\n${sidebar}`).not.toMatch(/\bundo\b|data-command=["']undo["']/i);
 });

 it('defines create_room_server as a service-only atomic command',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/20260919190348_create_room_server_command.sql',import.meta.url),'utf8');
  expect(migration).toContain('create function public.create_room_server');
  expect(migration).toContain('security invoker');
  expect(migration).toContain('set search_path = \'\'');
  for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.create_room_server(text, uuid, text) from ${role}`);
  expect(migration).toContain('grant execute on function public.create_room_server(text, uuid, text) to service_role');
  expect(migration).not.toMatch(/grant execute[^;]*to (?:anon|authenticated)/i);
  expect(migration).toContain('insert into public.rooms');
  expect(migration).toContain('insert into public.room_players');
  expect(migration).toContain('insert into public.room_states');
  const returnedColumns=migration.match(/returns table \(([\s\S]*?)\)\nlanguage/)?.[1]??'';
  expect(returnedColumns).not.toContain('game_state');
  expect(migration).toContain("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  expect(migration).toContain('for v_attempt in 1..10 loop');
 });

 it('keeps the create-room Edge Function authenticated and server authoritative',()=>{
  const source=readFileSync(new URL('../supabase/functions/create-room/index.ts',import.meta.url),'utf8');
  const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  expect(config).toMatch(/\[functions\.create-room\][\s\S]*verify_jwt\s*=\s*true/);
  expect(source).toContain("auth.getUser(token)");
  expect(source).not.toContain('SUPABASE_ANON_KEY');
  expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  expect(source).toContain("defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS')");
  expect(source).toContain("defaultNamedKey('SUPABASE_SECRET_KEYS')");
  expect(source).toContain("serverClient.rpc('create_room_server'");
  expect(source).not.toMatch(/['"](?:eyJ|sb_secret_|service_role[^'"]{8,})/i);
  expect(source).not.toMatch(/payload\.(?:userId|hostUserId)|\{\s*(?:userId|hostUserId)\s*\}/);
  expect(source).not.toContain('game_state');
 });

 it('enforces Edge Function slug limits and sanitizes RPC failures',()=>{
  const source=readFileSync(new URL('../supabase/functions/create-room/index.ts',import.meta.url),'utf8');
  expect(source).toContain('gameSlug.length<2');
  expect(source).toContain('gameSlug.length>64');
  expect(source).toContain("error.code==='22023'");
  expect(source).toContain("response(400,{error:'Invalid room request'})");
  expect(source).toContain("response(500,{error:'Unable to create room'})");
  expect(source).not.toMatch(/response\([^\n]*(?:error\.message|error\.details|error\.hint|error\.stack)/);
 });
});
