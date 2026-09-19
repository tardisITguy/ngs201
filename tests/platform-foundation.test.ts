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
  expect(importers).toHaveLength(1);
  expect(importers[0]).toMatch(/\/src\/platform\/supabase\/client\.ts$/);
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
});
