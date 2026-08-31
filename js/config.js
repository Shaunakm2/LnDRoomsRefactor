// js/config.js
// Everything here is static — set once, never reassigned at runtime.
// Anything that changes while the app runs belongs in state.js instead.

export const ROOMS = [
  { id: 'brihaspati',  name: 'Brihaspati',               floor: '2nd Floor', color: '#7B6FDF', colorLight: '#FAFAFE', capacity: 30, equipment: 'Projector' },
  { id: 'vedvyas',     name: 'Vedvyas',                   floor: '2nd Floor', color: '#2E9E6B', colorLight: '#F8FDFB', capacity: 30, equipment: 'Projector' },
  { id: 'conf2f',      name: '2nd Floor Conference Room', floor: '2nd Floor', color: '#3A8FC7', colorLight: '#F8FBFE', capacity: 5,  equipment: 'Projector' },
  { id: 'parashurama', name: 'Parashurama',               floor: '4th Floor', color: '#D4631A', colorLight: '#FEFAF7', capacity: 30, equipment: 'Interactive Panel' },
  { id: 'pingala',     name: 'Pingala',                   floor: '4th Floor', color: '#B8860B', colorLight: '#FEFDF7', capacity: 30, equipment: 'Interactive Panel' },
  { id: 'chanakya',    name: 'Chanakya',                  floor: '4th Floor', color: '#8E44AD', colorLight: '#FDF9FF', capacity: 45, equipment: 'Interactive Panel' },
  { id: 'bhardwaja',   name: 'Bhardwaja',                 floor: '4th Floor', color: '#1A9B94', colorLight: '#F7FEFE', capacity: 30, equipment: 'TV' },
  { id: 'vishwamitra', name: 'Vishwamitra',               floor: '2nd Floor', color: '#C0395A', colorLight: '#FFF8FA', capacity: 30, equipment: 'Projector' },
  { id: 'vasistha',    name: 'Vasistha',                  floor: '2nd Floor', color: '#2471A3', colorLight: '#F7FBFE', capacity: 30, equipment: 'Projector' },
  { id: 'sharada',     name: 'Sharada',                   floor: '2nd Floor', color: '#5D8A27', colorLight: '#F8FCF4', capacity: 30, equipment: 'Projector' },
];

export function roomName(id) {
  const r = ROOMS.find(r => r.id === id);
  return r ? r.name : id;
}

export const SUPABASE_URL = 'https://xgrwmwibfkuxzkuuidsh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__-SxyNxa9RJAZyW81_a27A_O_kv5Gl-';
// This key is INTENTIONALLY public — it's a publishable/anon key, meant to
// ship to the browser. Real protection comes from Row Level Security
// policies in Supabase, not from hiding this string. See supabase/schema.sql.
export const ADMIN_EMAIL = 'shaunakmistry4@gmail.com';

export const TEAMS_NOTIFY_URL = 'https://xgrwmwibfkuxzkuuidsh.supabase.co/functions/v1/teams-notify';

export const PAGE_SIZE = 15; // bookings per page in admin table
