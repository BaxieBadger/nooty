const isConfigured =
  typeof SUPABASE_URL === 'string' &&
  !SUPABASE_URL.includes('dit-projekt') &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  !SUPABASE_ANON_KEY.includes('din-anon');

const supabaseClient = isConfigured
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function requireSupabaseConfigured(targetEl) {
  if (!supabaseClient && targetEl) {
    targetEl.innerHTML =
      '<p class="empty-state">Siden er ikke sat op endnu. Udfyld js/supabase-config.js med jeres Supabase-projekt.</p>';
  }
  return Boolean(supabaseClient);
}
