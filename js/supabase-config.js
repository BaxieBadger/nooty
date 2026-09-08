// Eget Supabase-projekt til Lommepenge (adskilt fra det wall.html og
// index.html bruger).
//
// Det er helt trygt at have "anon public"-nøglen liggende i denne fil,
// selvom siden er offentlig — den er lavet til at blive brugt i browseren.
// Det er Row Level Security-reglerne i supabase/schema.sql, der bestemmer,
// hvad nøglen reelt må: alle må læse saldi/bevægelser, men kun jer der er
// logget ind på admin.html kan tilføje eller slette bevægelser.
const SUPABASE_URL = 'https://jkkyprdcamixcwnszfkq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impra3lwcmRjYW1peGN3bnN6ZmtxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMjA2NjYsImV4cCI6MjEwMzY5NjY2Nn0.fAWiMr2T5RRRrhuyhMgC4K1pz35VjSGwpw2dkP6qX8M';
