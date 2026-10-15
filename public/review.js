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

// --- Products & Keywords Editor Modal Logic ---
const productsDialog = document.querySelector('#products-dialog');
const modalSelect = document.querySelector('#modal-product-select');
const modalBtnAdd = document.querySelector('#modal-btn-add');
const modalActive = document.querySelector('#modal-active');
const modalFileBadge = document.querySelector('#modal-file-badge');
const modalName = document.querySelector('#modal-name');
const modalHomepage = document.querySelector('#modal-homepage');
const modalKeywords = document.querySelector('#modal-keywords');
const modalKeywordsCount = document.querySelector('#modal-keywords-count');
const modalDescription = document.querySelector('#modal-description');
const modalVoice = document.querySelector('#modal-voice');
const modalGuidance = document.querySelector('#modal-guidance');
const modalThreshold = document.querySelector('#modal-threshold');
const modalSkip = document.querySelector('#modal-skip');
const modalSaveBtn = document.querySelector('#modal-save-btn');
const modalStatus = document.querySelector('#modal-status');
const modalCloseX = document.querySelector('#modal-close-x');
const modalCancelBtn = document.querySelector('#modal-cancel-btn');
const btnProducts = document.querySelector('#btn-products');
const btnQuickEdit = document.querySelector('#btn-quick-edit');

let loadedProducts = [];
let isNewProductMode = false;

function updateKeywordsCount() {
  const lines = modalKeywords.value.split('\n').map(l => l.trim()).filter(Boolean);
  modalKeywordsCount.textContent = `${lines.length} phrase${lines.length === 1 ? '' : 's'}`;
}

modalKeywords.addEventListener('input', updateKeywordsCount);

function setModalStatus(text, error = false) {
  modalStatus.textContent = text;
  modalStatus.classList.toggle('error', error);
  modalStatus.classList.toggle('success', !error && Boolean(text));
}

function fillModalFields(prod) {
  isNewProductMode = false;
  modalActive.checked = prod.active !== false;
  modalFileBadge.textContent = prod.fileName || `${prod.id}.json`;
  modalName.value = prod.name || '';
  modalHomepage.value = prod.homepage || '';
  modalKeywords.value = Array.isArray(prod.keywords) ? prod.keywords.join('\n') : '';
  modalDescription.value = prod.description || '';
  modalVoice.value = prod.voice || '';
  modalGuidance.value = prod.guidance || '';
  modalThreshold.value = prod.reviewThreshold ?? 75;
  modalSkip.value = Array.isArray(prod.skipText) ? prod.skipText.join(', ') : '';
  updateKeywordsCount();
  setModalStatus('');
}

async function fetchProductsForModal(selectId) {
  setModalStatus('Loading products...');
  try {
    const res = await request('/api/products');
    loadedProducts = res.products || [];
    modalSelect.replaceChildren(
      ...loadedProducts.map(p => new Option(p.active ? p.name : `${p.name} (paused)`, p.id))
    );

    const targetId = selectId || modalSelect.value || (loadedProducts[0]?.id ?? '');
    if (targetId) {
      modalSelect.value = targetId;
      const target = loadedProducts.find(p => p.id === targetId);
      if (target) fillModalFields(target);
    }
    setModalStatus('');
  } catch (err) {
    setModalStatus(err.message, true);
  }
}

async function openProductsDialog(preferredId) {
  setModalStatus('');
  await fetchProductsForModal(preferredId || productFilter.value);
  productsDialog.showModal();
}

modalSelect.addEventListener('change', () => {
  const chosen = loadedProducts.find(p => p.id === modalSelect.value);
  if (chosen) fillModalFields(chosen);
});

modalBtnAdd.addEventListener('click', () => {
  const key = prompt('Enter unique ID for new product (e.g. "myproduct" or "cookbot"):');
  if (!key) return;
  const sanitized = key.toLowerCase().replace(/[^a-z0-9_-]/g, '').trim();
  if (!sanitized) {
    alert('Invalid ID. Use letters, numbers, hyphens or underscores.');
    return;
  }
  isNewProductMode = sanitized;
  modalSelect.replaceChildren(
    new Option(`+ New: ${sanitized}`, sanitized),
    ...loadedProducts.map(p => new Option(p.name, p.id))
  );
  modalSelect.value = sanitized;
  modalActive.checked = true;
  modalFileBadge.textContent = `${sanitized}.json (new)`;
  modalName.value = sanitized;
  modalHomepage.value = '';
  modalKeywords.value = '';
  modalDescription.value = '';
  modalVoice.value = 'Helpful, warm, and conversational.';
  modalGuidance.value = 'Provide one useful answer first, then mention the product naturally.';
  modalThreshold.value = 75;
  modalSkip.value = '#ad, giveaway, sponsored';
  updateKeywordsCount();
  setModalStatus(`Ready to configure new product: ${sanitized}`);
});

modalSaveBtn.addEventListener('click', async () => {
  const keywords = modalKeywords.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (keywords.length === 0) {
    setModalStatus('Error: At least one search phrase / keyword is required.', true);
    modalKeywords.focus();
    return;
  }

  const name = modalName.value.trim();
  if (!name) {
    setModalStatus('Error: Product name is required.', true);
    modalName.focus();
    return;
  }

  const threshold = Number(modalThreshold.value);
  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    setModalStatus('Error: Match score must be between 0 and 100.', true);
    modalThreshold.focus();
    return;
  }

  const skipText = modalSkip.value
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean);

  const payload = {
    active: modalActive.checked,
    name,
    homepage: modalHomepage.value.trim(),
    keywords,
    description: modalDescription.value.trim(),
    voice: modalVoice.value.trim(),
    guidance: modalGuidance.value.trim(),
    reviewThreshold: threshold,
    skipText,
  };

  modalSaveBtn.disabled = true;
  setModalStatus('Saving product settings to disk...');

  try {
    let result;
    if (isNewProductMode) {
      payload.id = isNewProductMode;
      result = await request('/api/products', payload, { method: 'POST' });
    } else {
      const id = modalSelect.value;
      result = await request(`/api/products/${encodeURIComponent(id)}`, payload, { method: 'PUT' });
    }

    setModalStatus(`✅ Saved! Product "${result.product.name}" updated successfully.`);
    await fetchProductsForModal(result.product.id);
    await load(); // Reload dashboard products & filters
  } catch (err) {
    setModalStatus(`Failed to save: ${err.message}`, true);
  } finally {
    modalSaveBtn.disabled = false;
  }
});

modalCloseX.addEventListener('click', () => productsDialog.close());
modalCancelBtn.addEventListener('click', () => productsDialog.close());
btnProducts.addEventListener('click', () => openProductsDialog());
btnQuickEdit.addEventListener('click', () => openProductsDialog(productFilter.value));

load();

