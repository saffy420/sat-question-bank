(() => {
  'use strict';
  const button = document.getElementById('google-signin');
  const error = document.getElementById('auth-error');
  const status = document.getElementById('auth-status');
  let sb;
  let busy = false;
  const fail = (message) => { error.textContent = message; status.textContent = ''; button.disabled = false; };
  try {
    sb = window.supabase.createClient('https://cxlzflzdlegosybkklma.supabase.co', 'sb_publishable_M0q3BurnPJpEHlrrZAOdaQ_SpgvOPC1');
  } catch {
    fail('Sign-in could not load. Reload this page to try again.');
    button.disabled = true;
    return;
  }
  async function bootstrap(session) {
    if (!session || busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = 'Checking membership…';
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token }
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) await sb.auth.signOut({ scope: 'local' });
        fail(response.status === 403 ? 'Membership access denied. Contact Leon for review.' : 'Could not verify access. Sign in with Google or try again later.');
        return;
      }
      history.replaceState(null, '', '/login');
      location.replace('/app');
    } catch {
      fail('Could not reach the server. Try again.');
    } finally {
      busy = false;
    }
  }
  button.onclick = async () => {
    error.textContent = '';
    button.disabled = true;
    status.textContent = 'Opening Google sign-in…';
    try {
      const result = await sb.auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: location.origin + '/auth/callback', queryParams: { prompt: 'select_account' }
      } });
      if (result.error) fail('Google sign-in failed. Try again.');
    } catch { fail('Google sign-in failed. Try again.'); }
  };
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('error') || new URLSearchParams(location.search).has('error')) {
    history.replaceState(null, '', '/login');
    fail('Google sign-in was cancelled or failed. Try again.');
    return;
  }
  sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => bootstrap(session), 0); });
  sb.auth.getSession().then(({ data, error: sessionError }) => {
    if (sessionError) fail('Could not restore sign-in. Try again.');
    else bootstrap(data.session);
  }).catch(() => fail('Could not restore sign-in. Try again.'));
  if (new URLSearchParams(location.search).has('denied')) fail('Membership access denied. Contact Leon for review.');
})();
