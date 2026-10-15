const posts = document.querySelector('#posts');
const message = document.querySelector('#message');
let dryRun = true;
let loading = false;
let busy = 0;
let matchedPosts = [];
let renderedProduct = '';
const productFilter = document.querySelector('#product-filter');

function renderMatches() {
  const selected = productFilter.value;
  renderedProduct = selected;
  posts.replaceChildren(...matchedPosts.filter(post => !selected || post.campaign_id === selected).map(renderPost));
  updateCount();
}

async function request(url, body, options = {}) {
  const method = options.method || (body !== undefined ? 'POST' : 'GET');
  const headers = { 'Accept': 'application/json', ...(options.headers || {}) };
  const fetchOptions = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }
  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${response.status})`);
  }
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
}

function updateCount() {
  document.querySelector('#count').textContent = posts.querySelectorAll('.card').length;
  if (!posts.children.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'All caught up. Find new matches to review more conversations.';
    posts.append(empty);
  }
}

function renderPost(post) {
  const card = document.querySelector('#post-template').content.firstElementChild.cloneNode(true);
  card.querySelector('.author').textContent = `@${post.username}`;
  card.querySelector('.campaign').textContent = post.productName || post.campaign_id;
  card.querySelector('.score').textContent = `${post.ai_score ?? '—'} / 100 match`;
  card.querySelector('.post-text').textContent = post.post_text;
  card.querySelector('.reason').textContent = post.ai_reasoning || '';
  const link = card.querySelector('.permalink');
  try {
    const url = new URL(post.permalink);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid link');
    link.href = url.href;
  } catch { link.remove(); }
  const draft = card.querySelector('textarea');
  draft.value = post.reply_text || '';
  draft.setAttribute('aria-label', `Reply for ${post.productName || post.campaign_id}, up to ${post.characterBudget || 500} characters`);
  let savedText = draft.value;
  const edit = card.querySelector('[data-action="edit"]');
  const feedback = card.querySelector('.feedback');
  card.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'edit' && draft.readOnly) {
      draft.readOnly = false;
      edit.textContent = 'Save text';
      draft.focus();
      return;
    }
    if (action === 'regenerate' && draft.value !== savedText && !confirm('Replace your unsaved edits with a new response?')) return;
    busy++;
    const wasReadOnly = draft.readOnly;
    draft.readOnly = true;
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    feedback.classList.remove('error');
    if (action === 'send') {
      feedback.textContent = 'Publishing live to Threads… Processing container (~20s).';
    } else if (action === 'queue') {
      feedback.textContent = 'Queuing reply for scheduled posting…';
    } else {
      feedback.textContent = 'Working…';
    }
    try {
      const data = await request(`/api/review/${encodeURIComponent(post.post_id)}/${action}`, {
        replyText: draft.value,
        live: action === 'send',
      });
      if (action === 'reject' || action === 'send') {
        matchedPosts = matchedPosts.filter(item => item.post_id !== post.post_id);
        card.remove(); updateCount(); setMessage(data.message);
      } else if (action === 'queue') {
        savedText = draft.value;
        post.reply_text = savedText;
        draft.readOnly = true;
        edit.textContent = 'Edit text';
        feedback.textContent = '✅ Saved in queue for scheduled posting.';
        setMessage(`Reply for @${post.username} queued.`);
      } else {
        draft.value = data.post.reply_text;
        savedText = draft.value;
        post.reply_text = savedText;
        draft.readOnly = true;
        edit.textContent = 'Edit text';
        feedback.textContent = data.message;
      }
    } catch (error) {
      draft.readOnly = wasReadOnly;
      feedback.textContent = error.message;
      feedback.classList.add('error');
    } finally {
      busy--;
      card.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  });
  return card;
}

async function updateAuthStatus() {
  try {
    const authStatus = await request('/auth/status', undefined, { method: 'GET' });
    const authBtn = document.querySelector('#auth-btn');
    const logoutBtn = document.querySelector('#logout-btn');
    const quotaBadge = document.querySelector('#quota-badge');

    if (authBtn) {
      if (authStatus.username) {
        authBtn.textContent = `✅ Connected: @${authStatus.username}`;
        authBtn.style.background = '#065f46';
        authBtn.style.color = '#a7f3d0';
        authBtn.title = 'Threads account connected (token auto-refresh enabled). Click to reconnect.';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';

        if (quotaBadge && authStatus.quota) {
          const q = authStatus.quota;
          quotaBadge.style.display = 'inline-block';
          quotaBadge.textContent = `📊 Quota: ${q.replyUsage} / ${q.replyTotal} replies (24h)`;
          quotaBadge.title =
            `Meta Threads 24h Limits:\n` +
            `• Replies used: ${q.replyUsage} of ${q.replyTotal}\n` +
            `• Remaining replies: ${q.remainingReplies}\n` +
            `• Root posts used: ${q.postUsage} of ${q.postTotal}\n` +
            `• Token Auto-Refresh: Active (60-day token auto-refreshed daily)`;
          quotaBadge.className =
            'badge quota-badge ' +
            (q.replyUsage >= q.replyTotal ? 'danger' : q.replyUsage > q.replyTotal * 0.75 ? 'warning' : 'ok');
        } else if (quotaBadge) {
          quotaBadge.style.display = 'none';
        }
      } else {
        authBtn.textContent = '🔗 Connect Threads';
        authBtn.style.background = '#1e3a8a';
        authBtn.style.color = '#bfdbfe';
        authBtn.title = 'Click to connect your Threads account via OAuth.';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (quotaBadge) quotaBadge.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('Could not update auth status:', err);
  }
}

const logoutBtn = document.querySelector('#logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    const ok = confirm(
      'Disconnect this Threads account?\n\n' +
      'To log in with a DIFFERENT account:\n' +
      '1. Click OK to disconnect.\n' +
      '2. Make sure you are logged into your other account on https://www.threads.net (or use an incognito window).\n' +
      '3. Click "🔗 Connect Threads" to authorize the new account.'
    );
    if (!ok) return;

    try {
      await request('/auth/logout', {}, { method: 'POST' });
      setMessage('Threads account disconnected. You can now connect a different account.');
      await updateAuthStatus();
    } catch (err) {
      setMessage(err.message, true);
    }
  });
}

async function load() {
  if (loading || busy) return;
  if (posts.querySelector('textarea:not([readonly])') && !confirm('Refresh and discard unsaved edits?')) return;
  loading = true;
  try {
    await updateAuthStatus();
    const data = await request('/api/review');
    dryRun = data.dryRun;
    const selected = productFilter.value;
    productFilter.replaceChildren(new Option('All products', ''), ...data.products.map(product => new Option(product.name, product.id)));
    productFilter.value = selected;
    matchedPosts = data.posts;
    renderMatches();
  } catch (error) { setMessage(error.message, true); }
  finally { loading = false; }
}

document.querySelector('#refresh').addEventListener('click', load);

const importPostBtn = document.querySelector('#import-post-btn');
if (importPostBtn) {
  importPostBtn.addEventListener('click', async () => {
    importPostBtn.disabled = true;
    setMessage('Fetching latest real post from your connected Threads account…');
    try {
      const res = await request('/api/review/import-my-post', {});
      setMessage(res.message);
      await load();
    } catch (err) {
      setMessage(err.message, true);
    } finally {
      importPostBtn.disabled = false;
    }
  });
}

productFilter.addEventListener('change', async () => {
  if (busy || loading || (posts.querySelector('textarea:not([readonly])') && !confirm('Switch products and discard unsaved edits?'))) {
    productFilter.value = renderedProduct;
    return;
  }
  renderMatches();
});
document.querySelector('#source').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setMessage('Finding and evaluating new posts…');
  try {
    const data = await request('/run-once', productFilter.value ? { campaignId: productFilter.value } : {});
    const count = data.results.sourcing.reduce((total, result) => total + result.queued, 0);
    setMessage(`${count} new matches found.`);
    await load();
  } catch (error) { setMessage(error.message, true); }
  finally { button.disabled = false; }
});
load();
