const $ = id => document.getElementById(id);
let mode = 'login', busy = false;

function show(next) {
  mode = next;
  const setup = mode !== 'login';
  $('access-title').textContent = mode === 'setup' ? 'Set up your owner account' : mode === 'recovery' ? 'Reset your password' : 'Welcome back';
  document.title = 'Crowsnest · ' + (mode === 'setup' ? 'Owner setup' : mode === 'recovery' ? 'Password recovery' : 'Sign in');
  $('access-description').textContent = mode === 'setup' ? 'Use a server code to claim this private instance.' : mode === 'recovery' ? 'Use a server recovery code to reset your password. Resetting signs out existing browser sessions.' : 'Sign in to see your fleet.';
  $('access-submit').textContent = mode === 'setup' ? 'Create owner account' : mode === 'recovery' ? 'Reset password and sign in' : 'Sign in';
  $('code-field').hidden = !setup;
  $('access-code').required = setup;
  $('access-code').value = '';
  $('access-password').value = '';
  $('access-password').autocomplete = setup ? 'new-password' : 'current-password';
  $('access-password').minLength = setup ? 12 : 0;
  $('password-help').hidden = !setup;
  $('server-code-help').hidden = !setup;
  $('server-code-command').textContent = 'docker compose exec crowsnest node server/cli.mjs ' + (mode === 'recovery' ? 'reset-token' : 'setup-token');
  $('access-recovery').hidden = setup;
  $('access-back').hidden = mode !== 'recovery';
  $('access-form').hidden = false;
  $('access-retry').hidden = true;
  $('access-message').textContent = '';
  document.querySelector('.access-form').setAttribute('aria-busy', 'false');
}

async function connect() {
  $('access-retry').disabled = true;
  try {
    const response = await fetch('/auth/state', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Unable to connect');
    const state = await response.json();
    if (typeof state.setupRequired !== 'boolean') throw new Error('Invalid server response');
    show(state.setupRequired ? 'setup' : new URLSearchParams(location.search).get('recover') === '1' ? 'recovery' : 'login');
  } catch {
    $('access-title').textContent = 'Unable to connect';
    $('access-description').textContent = 'Check that Crowsnest is running, then retry.';
    $('access-retry').hidden = false;
    document.querySelector('.access-form').setAttribute('aria-busy', 'false');
  } finally { $('access-retry').disabled = false; }
}

$('access-retry').onclick = connect;
$('access-recovery').onclick = () => { show('recovery'); $('access-code').focus(); };
$('access-back').onclick = () => { show('login'); $('access-username').focus(); };
$('access-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const label = $('access-submit').textContent;
  $('access-submit').disabled = true;
  $('access-recovery').disabled = true;
  $('access-back').disabled = true;
  $('access-submit').textContent = mode === 'login' ? 'Signing in…' : 'Saving your account…';
  $('access-message').textContent = '';
  try {
    const data = {username: $('access-username').value.trim(), password: $('access-password').value};
    if (mode !== 'login') Object.assign(data, {code: $('access-code').value.trim(), recovery: mode === 'recovery'});
    const response = await fetch(mode === 'login' ? '/auth/login' : '/auth/setup', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data), signal: AbortSignal.timeout(15000)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to sign in. Try again.');
    // Clear credentials before navigation; never put them in browser storage.
    $('access-password').value = '';
    $('access-code').value = '';
    location.assign('/');
  } catch (error) {
    $('access-message').textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Unable to reach Crowsnest. Check your connection, then try again.' : error.message;
  } finally {
    busy = false;
    $('access-submit').disabled = false;
    $('access-recovery').disabled = false;
    $('access-back').disabled = false;
    $('access-submit').textContent = label;
  }
};
connect();
