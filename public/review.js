const postsContainer = document.querySelector('#posts');
const messageEl = document.querySelector('#message');
let loading = false;
let busy = 0;
let matchedPosts = [];
let renderedProduct = '';
const productFilter = document.querySelector('#product-filter');

function renderMatches() {
  const selected = productFilter.value;
  renderedProduct = selected;
  const filtered = matchedPosts.filter(post => !selected || post.campaign_id === selected);
  postsContainer.replaceChildren(...filtered.map(renderPost));
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
  messageEl.textContent = text;
  messageEl.classList.toggle('error', error);
}

function updateCount() {
  const count = postsContainer.querySelectorAll('.card').length;
  document.querySelector('#count').textContent = count;
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'All caught up! Click "Find new matches" to source fresh discussions from Threads.';
    postsContainer.append(empty);
  }
}

function buildIntentUrl(shortcodeOrUrl, text) {
  const match = shortcodeOrUrl.match(/\/post\/([A-Za-z0-9_-]+)/);
  const shortcode = match ? match[1] : shortcodeOrUrl.trim();
  const params = new URLSearchParams({
    reply_post_shortcode: shortcode,
    text: text.trim(),
  });
  return `https://www.threads.com/intent/post?${params.toString()}`;
}

function renderPost(post) {
  const card = document.querySelector('#post-template').content.firstElementChild.cloneNode(true);
  card.querySelector('.author').textContent = `@${post.username}`;
  
  const shortcodeBadge = card.querySelector('.shortcode-badge');
  if (post.shortcode) {
    shortcodeBadge.textContent = `#${post.shortcode}`;
  } else {
    shortcodeBadge.remove();
  }

  card.querySelector('.campaign').textContent = post.productName || post.campaign_id;
  const score = post.relevanceScore ?? post.ai_score;
  card.querySelector('.score').textContent = `${score ?? '—'} / 100 match`;
  card.querySelector('.post-text').textContent = post.post_text;
  card.querySelector('.reason').textContent = post.ai_reasoning || '';

  const link = card.querySelector('.permalink');
  try {
    const url = new URL(post.permalink || `https://www.threads.com/@${post.username}/post/${post.shortcode || ''}`);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid link');
    link.href = url.href;
  } catch {
    link.remove();
  }

  const draft = card.querySelector('textarea');
  draft.value = post.reply_text || post.aiDraftReply || '';
  draft.setAttribute('aria-label', `Reply for ${post.productName || post.campaign_id}`);
  let savedText = draft.value;
  const editBtn = card.querySelector('[data-action="edit"]');
  const feedback = card.querySelector('.feedback');

  card.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;

    // Sub-action: Edit toggling
    if (action === 'edit') {
      if (draft.readOnly) {
        draft.readOnly = false;
        editBtn.textContent = 'Save draft';
        draft.focus();
        return;
      }

      // Save draft text
      busy++;
      const replyText = draft.value.trim();
      feedback.textContent = 'Saving draft…';
      try {
        const res = await request(`/api/review/${encodeURIComponent(post.post_id)}/edit`, { replyText });
        post.reply_text = replyText;
        savedText = replyText;
        post.intent_url = res.post?.intent_url || buildIntentUrl(post.shortcode || post.permalink, replyText);
        draft.readOnly = true;
        editBtn.textContent = 'Edit text';
        feedback.textContent = '✅ Draft saved!';
        setTimeout(() => { if (feedback.textContent.includes('saved')) feedback.textContent = ''; }, 3000);
      } catch (err) {
        feedback.textContent = err.message;
        feedback.classList.add('error');
      } finally {
        busy--;
      }
      return;
    }

    if (action === 'regenerate' && draft.value !== savedText && !confirm('Replace your unsaved edits with a new AI response?')) {
      return;
    }

    // 1-Click Threads Web Intent Launch
    if (action === 'open-intent') {
      busy++;
      card.querySelectorAll('button').forEach(b => b.disabled = true);
      feedback.textContent = 'Opening Threads composer…';

      try {
        const currentReplyText = draft.value.trim();
        // If there were unsaved edits, sync them to backend first
        if (!draft.readOnly || currentReplyText !== savedText) {
          await request(`/api/review/${encodeURIComponent(post.post_id)}/edit`, { replyText: currentReplyText });
          post.reply_text = currentReplyText;
          savedText = currentReplyText;
          draft.readOnly = true;
          editBtn.textContent = 'Edit text';
        }

        const intentUrl = post.intent_url || buildIntentUrl(post.shortcode || post.permalink || post.post_id, currentReplyText);

        // Copy text to clipboard for ultimate convenience
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(currentReplyText);
          } catch {}
        }

        // Open official Threads Intent URL in new tab
        window.open(intentUrl, '_blank', 'noopener,noreferrer');

        // Mark as replied in database
        await request(`/api/review/${encodeURIComponent(post.post_id)}/replied`, {});

        // Remove card from UI
        matchedPosts = matchedPosts.filter(item => item.post_id !== post.post_id);
        card.remove();
        updateCount();
        setMessage(`🚀 Opened Threads composer for @${post.username}! Marked as replied.`);
      } catch (err) {
        feedback.textContent = err.message;
        feedback.classList.add('error');
      } finally {
        busy--;
        card.querySelectorAll('button').forEach(b => b.disabled = false);
      }
      return;
    }

    // Manual Mark Replied
    if (action === 'replied') {
      busy++;
      card.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        await request(`/api/review/${encodeURIComponent(post.post_id)}/replied`, {});
        matchedPosts = matchedPosts.filter(item => item.post_id !== post.post_id);
        card.remove();
        updateCount();
        setMessage(`Post from @${post.username} marked as replied.`);
      } catch (err) {
        feedback.textContent = err.message;
        feedback.classList.add('error');
      } finally {
        busy--;
        card.querySelectorAll('button').forEach(b => b.disabled = false);
      }
      return;
    }

    // Ignore / Reject Post
    if (action === 'ignore' || action === 'reject') {
      busy++;
      card.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        await request(`/api/review/${encodeURIComponent(post.post_id)}/ignore`, {});
        matchedPosts = matchedPosts.filter(item => item.post_id !== post.post_id);
        card.remove();
        updateCount();
        setMessage(`Post ignored.`);
      } catch (err) {
        feedback.textContent = err.message;
        feedback.classList.add('error');
      } finally {
        busy--;
        card.querySelectorAll('button').forEach(b => b.disabled = false);
      }
      return;
    }

    // Regenerate AI Response
    if (action === 'regenerate') {
      busy++;
      card.querySelectorAll('button').forEach(b => b.disabled = true);
      feedback.textContent = 'Generating new draft with AI…';
      feedback.classList.remove('error');
      try {
        const res = await request(`/api/review/${encodeURIComponent(post.post_id)}/regenerate`, {});
        draft.value = res.post.reply_text;
        savedText = draft.value;
        post.reply_text = savedText;
        post.intent_url = res.post.intent_url;
        draft.readOnly = true;
        editBtn.textContent = 'Edit text';
        feedback.textContent = '✅ New draft generated.';
      } catch (err) {
        feedback.textContent = err.message;
        feedback.classList.add('error');
      } finally {
        busy--;
        card.querySelectorAll('button').forEach(b => b.disabled = false);
      }
    }
  });

  return card;
}

async function load() {
  if (loading || busy) return;
  if (postsContainer.querySelector('textarea:not([readonly])') && !confirm('Refresh and discard unsaved edits?')) return;
  loading = true;
  try {
    const data = await request('/api/review');
    const selected = productFilter.value;
    productFilter.replaceChildren(
      new Option('All products', ''),
      ...data.products.map(product => new Option(product.name, product.id))
    );
    productFilter.value = selected;
    matchedPosts = data.posts;
    renderMatches();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    loading = false;
  }
}

document.querySelector('#refresh').addEventListener('click', load);

productFilter.addEventListener('change', () => {
  if (busy || loading || (postsContainer.querySelector('textarea:not([readonly])') && !confirm('Switch products and discard unsaved edits?'))) {
    productFilter.value = renderedProduct;
    return;
  }
  renderMatches();
});

document.querySelector('#source').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setMessage('🔍 Sourcing discussions and generating AI drafts…');
  try {
    const data = await request('/run-once', productFilter.value ? { campaignId: productFilter.value } : {});
    const count = Array.isArray(data.results)
      ? data.results.reduce((total, result) => total + (result.pending ?? result.queued ?? 0), 0)
      : (data.results?.sourcing?.reduce((total, result) => total + (result.pending ?? result.queued ?? 0), 0) ?? 0);
    setMessage(`✅ Sourcing complete. ${count} new qualified drafts ready for review.`);
    await load();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

load();
