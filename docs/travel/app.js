(() => {
  const travelData = window.TRAVEL_DATA || {};
  const frame = document.querySelector('#map-frame');
  const svg = document.querySelector('#us-map');
  const bubble = document.querySelector('#photo-bubble');
  const status = document.querySelector('#map-status');
  const gallery = document.querySelector('#gallery');
  const galleryContent = document.querySelector('#gallery-content');
  const count = document.querySelector('#state-count');
  const colors = ['#e99bc4', '#b69de9', '#9faee9', '#d1a2df'];
  const numberOfStates = Object.keys(travelData).length;
  let pinnedState = null;
  let galleryState = null;
  let galleryIndex = 0;
  let galleryTrigger = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  count.textContent = `${numberOfStates} / 50`;

  const placeBubble = (x, y) => {
    const bounds = frame.getBoundingClientRect();
    const halfWidth = Math.min(151, bounds.width / 2 - 9);
    const left = Math.max(halfWidth + 8, Math.min(bounds.width - halfWidth - 8, x));
    const below = y < Math.max(180, bubble.offsetHeight * 0.72);
    const top = below ? Math.min(bounds.height - 8, y + 14) : Math.max(8, y - 14);
    bubble.classList.toggle('below', below);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };

  const renderBubble = (code, x, y, pin = false) => {
    const state = travelData[code];
    if (!state) return;
    if (pin) pinnedState = code;
    const memories = state.memories || [];
    const sampleImages = memories.slice(0, 3);
    const stack = sampleImages.length
      ? `<button class="bubble-stack" type="button" data-open-gallery="${escapeHtml(code)}" data-photo="0" aria-label="Open ${escapeHtml(state.name)} photo gallery">${sampleImages.map((photo, index) => {
          const layer = index === sampleImages.length - 1 ? 'stack-front' : index === sampleImages.length - 2 ? 'stack-mid' : 'stack-back';
          return `<img class="stack-image ${layer}" src="${escapeHtml(photo.src)}" alt="" style="--stack-index:${index}" />`;
        }).join('')}</button>`
      : `<button class="empty-stack" type="button" data-photo-folder="${escapeHtml(state.timeZoneFolder)}/${escapeHtml(code)}" disabled><span>✿</span><b>Drop your first photo here</b><small>photos/${escapeHtml(state.timeZoneFolder)}/${escapeHtml(code)}/</small></button>`;
    const placeNames = (state.places || []).map(place => `<span>${escapeHtml(place)}</span>`).join('');
    const footer = memories.length
      ? `<div class="bubble-footer"><span>${memories.length} ${memories.length === 1 ? 'photo' : 'photos'}</span><button type="button" data-open-gallery="${escapeHtml(code)}" data-photo="0">Open gallery →</button></div>`
      : `<div class="bubble-footer"><span>Sample state entry</span></div>`;
    bubble.innerHTML = `<div class="bubble-top"><div><h3>${escapeHtml(state.name)}</h3><p>${escapeHtml(state.subtitle)}</p></div><button class="bubble-close" type="button" aria-label="Close photo preview">×</button></div>
      ${stack}
      <div class="bubble-places">${placeNames}</div>
      <p class="bubble-note">${escapeHtml(state.note)}</p>
      ${footer}`;
    bubble.hidden = false;
    placeBubble(x, y);
    svg.querySelectorAll('.state').forEach(path => path.classList.toggle('pinned', pin && path.dataset.code === code));
  };

  const hideBubble = (clearPin = true) => {
    bubble.hidden = true;
    if (clearPin) pinnedState = null;
    svg.querySelectorAll('.state.pinned').forEach(path => path.classList.remove('pinned'));
  };

  const renderGallery = () => {
    const state = travelData[galleryState];
    const memories = state?.memories || [];
    if (!state || !memories.length) return;
    galleryIndex = (galleryIndex + memories.length) % memories.length;
    const photo = memories[galleryIndex];
    galleryContent.innerHTML = `<h2 class="gallery-title">${escapeHtml(state.name)}</h2>
      <p class="gallery-subtitle">${escapeHtml(state.subtitle)}</p>
      <img class="gallery-photo${photo.demo ? ' is-demo' : ''}" src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt)}" />
      <p class="gallery-caption">${escapeHtml(photo.caption)}</p>
      <div class="gallery-controls"><button type="button" data-step="-1" aria-label="Previous photo">← Previous</button><span class="gallery-position">${galleryIndex + 1} / ${memories.length}</span><button type="button" data-step="1" aria-label="Next photo">Next →</button></div>`;
  };

  const openGallery = (code, index, trigger) => {
    if (!travelData[code]?.memories?.length) return;
    galleryState = code;
    galleryIndex = index;
    galleryTrigger = trigger;
    renderGallery();
    gallery.hidden = false;
    document.body.classList.add('gallery-open');
    document.querySelector('.gallery-close').focus();
  };

  const closeGallery = () => {
    gallery.hidden = true;
    document.body.classList.remove('gallery-open');
    galleryTrigger?.focus?.();
  };

  bubble.addEventListener('click', event => {
    if (event.target.closest('.bubble-close')) {
      event.stopPropagation();
      hideBubble();
      return;
    }
    const button = event.target.closest('[data-open-gallery]');
    if (button) {
      event.stopPropagation();
      openGallery(button.dataset.openGallery, Number(button.dataset.photo || 0), button);
    }
  });

  galleryContent.addEventListener('click', event => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    galleryIndex += Number(button.dataset.step);
    renderGallery();
  });

  gallery.addEventListener('click', event => {
    if (event.target.closest('[data-close-gallery]')) closeGallery();
  });
  gallery.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { galleryIndex--; renderGallery(); }
    if (event.key === 'ArrowRight') { galleryIndex++; renderGallery(); }
  });

  frame.addEventListener('pointerleave', () => {
    if (!pinnedState) hideBubble(false);
  });

  frame.addEventListener('click', event => {
    if (event.target === frame || event.target === svg) hideBubble();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!gallery.hidden) closeGallery();
      else hideBubble();
    }
  });

  const bindState = (path, state) => {
    const place = travelData[state.code];
    const visited = Boolean(place);
    path.setAttribute('class', `state${visited ? ' visited' : ''}`);
    path.dataset.code = state.code;
    path.setAttribute('aria-label', visited
      ? `${place.name}, demo travel entry. Activate to pin its photo preview.`
      : `${state.name}, no travel entry yet.`);
    if (visited) {
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.style.setProperty('--state-fill', colors[Object.keys(travelData).indexOf(state.code) % colors.length]);
    } else {
      path.setAttribute('aria-hidden', 'true');
    }
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = state.name;
    path.append(title);

    path.addEventListener('pointerenter', event => {
      if (pinnedState) return;
      if (!visited) { hideBubble(false); return; }
      const bounds = frame.getBoundingClientRect();
      renderBubble(state.code, event.clientX - bounds.left, event.clientY - bounds.top);
    });
    path.addEventListener('pointermove', event => {
      if (!pinnedState && visited) {
        const bounds = frame.getBoundingClientRect();
        placeBubble(event.clientX - bounds.left, event.clientY - bounds.top);
      }
    });
    path.addEventListener('click', event => {
      if (!visited) { hideBubble(); return; }
      event.stopPropagation();
      const bounds = frame.getBoundingClientRect();
      if (pinnedState === state.code) hideBubble();
      else renderBubble(state.code, event.clientX - bounds.left, event.clientY - bounds.top, true);
    });
    path.addEventListener('keydown', event => {
      if (!visited || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      const svgBounds = svg.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      const x = svgBounds.left - frameBounds.left + state.center[0] * svgBounds.width / 960;
      const y = svgBounds.top - frameBounds.top + state.center[1] * svgBounds.height / 600;
      if (pinnedState === state.code) hideBubble();
      else renderBubble(state.code, x, y, true);
    });
  };

  const loadMap = async () => {
    try {
      const response = await fetch('./state-paths.json?v=2');
      if (!response.ok) throw new Error(`Map data returned ${response.status}`);
      const states = await response.json();
      svg.innerHTML = states.map(state => `<path d="${state.path}" />`).join('');
      [...svg.querySelectorAll('path')].forEach((path, index) => bindState(path, states[index]));
      status.hidden = true;
    } catch (error) {
      status.textContent = 'The map could not load. Run “npm run build:travel” and refresh.';
      console.error('Could not load the US state map', error);
    }
  };

  loadMap();

  const params = new URLSearchParams(window.location.search);
  const sharedState = params.get('state')?.toUpperCase();
  const sharedPhoto = Number.parseInt(params.get('photo') || '0', 10);
  if (travelData[sharedState]?.memories?.length) {
    openGallery(sharedState, Number.isFinite(sharedPhoto) ? sharedPhoto : 0, null);
  }
})();
