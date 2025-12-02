const MAX_PAGES = 60;
const MAX_DEPTH = 3;
const TIMEOUT_MS = 10000;
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v'];

let hdToggle;
let videoGrid;
let metaInfo;
let metaBar;
let errorMessage;
let statusMessage;
let emptyState;
let startUrlInput;
let scanButton;
let hdToggleWrapper;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeInputUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch (err) {
    return null;
  }
}

function extractMetaContent(doc, selector) {
  const el = doc.querySelector(selector);
  return el?.getAttribute('content')?.trim() || '';
}

function buildFilename(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.split('/').filter(Boolean).pop() || '';
    return pathname.split('#')[0].split('?')[0];
  } catch (err) {
    return '';
  }
}

function parsePage(html, pageUrl, startHost) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const pageTitle = extractMetaContent(doc, 'meta[property="og:title"]') || doc.querySelector('title')?.textContent?.trim() || '';
  const pageDesc = extractMetaContent(doc, 'meta[property="og:description"]') || extractMetaContent(doc, 'meta[name="description"]') || '';

  const videos = [];
  const addVideo = (rawUrl) => {
    if (!rawUrl) return;
    let absolute;
    try {
      absolute = new URL(rawUrl, pageUrl).toString();
    } catch (err) {
      return;
    }
    const filename = buildFilename(absolute);
    const description = pageDesc || filename || 'No description available';
    const title = pageTitle || filename || 'Untitled page';
    videos.push({
      videoUrl: absolute,
      pageUrl,
      pageTitle: title,
      description,
      filename: filename || 'Unknown file',
    });
  };

  doc.querySelectorAll('video').forEach((videoEl) => {
    const src = videoEl.getAttribute('src');
    addVideo(src);
    videoEl.querySelectorAll('source').forEach((sourceEl) => addVideo(sourceEl.getAttribute('src')));
  });

  const linksForCrawling = new Set();
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    let resolved;
    try {
      resolved = new URL(href, pageUrl);
    } catch (err) {
      return;
    }
    const ext = resolved.pathname.split('.').pop()?.toLowerCase();
    if (ext && VIDEO_EXTS.includes(ext)) {
      addVideo(resolved.toString());
    }
    if (resolved.host === startHost && (resolved.protocol === 'http:' || resolved.protocol === 'https:')) {
      linksForCrawling.add(resolved.toString());
    }
  });

  return { videos, nextLinks: Array.from(linksForCrawling) };
}

async function crawl(startUrl) {
  const queue = [[startUrl, 0]];
  const visited = new Set();
  const seenVideos = new Set();
  const results = [];
  const startHost = new URL(startUrl).host;
  let pagesProcessed = 0;

  while (queue.length > 0 && pagesProcessed < MAX_PAGES) {
    const [currentUrl, depth] = queue.shift();
    if (visited.has(currentUrl) || depth > MAX_DEPTH) continue;
    visited.add(currentUrl);

    const response = await fetchWithTimeout(currentUrl, TIMEOUT_MS);
    if (!response || !response.ok) continue;
    const html = await response.text();
    pagesProcessed += 1;

    const { videos, nextLinks } = parsePage(html, response.url || currentUrl, startHost);
    videos.forEach((video) => {
      if (seenVideos.has(video.videoUrl)) return;
      seenVideos.add(video.videoUrl);
      results.push(video);
    });
    nextLinks.forEach((link) => {
      if (!visited.has(link)) {
        queue.push([link, depth + 1]);
      }
    });
  }

  return results;
}

function clearResults() {
  videoGrid.innerHTML = '';
  emptyState.style.display = 'none';
}

function renderResults(results) {
  clearResults();
  if (!results.length) {
    emptyState.style.display = 'block';
    hdToggleWrapper.classList.add('hidden');
    return;
  }

  hdToggleWrapper.classList.remove('hidden');
  results.forEach((result) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.isHd = '0';

    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'metadata';
    video.src = result.videoUrl;

    const info = document.createElement('div');
    info.className = 'info';

    const titleEl = document.createElement('h3');
    titleEl.textContent = result.pageTitle;

    const descEl = document.createElement('p');
    descEl.className = 'desc';
    descEl.textContent = result.description;

    const metaRow = document.createElement('div');
    metaRow.className = 'card-meta';

    const fileBadge = document.createElement('span');
    fileBadge.className = 'badge';
    fileBadge.textContent = 'File';

    const filenameEl = document.createElement('span');
    filenameEl.className = 'filename';
    filenameEl.textContent = result.filename;

    const resolutionEl = document.createElement('span');
    resolutionEl.className = 'resolution';
    resolutionEl.textContent = 'Loading...';

    const hdBadge = document.createElement('span');
    hdBadge.className = 'badge hd hidden';
    hdBadge.textContent = 'HD';

    metaRow.append(fileBadge, filenameEl, resolutionEl, hdBadge);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';

    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'btn primary';
    downloadBtn.href = result.videoUrl;
    downloadBtn.download = result.filename || '';
    downloadBtn.textContent = 'Download';

    const openBtn = document.createElement('a');
    openBtn.className = 'btn secondary';
    openBtn.href = result.pageUrl;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    openBtn.textContent = 'Open source page';

    btnRow.append(downloadBtn, openBtn);

    info.append(titleEl, descEl, metaRow, btnRow);
    card.append(video, info);
    videoGrid.appendChild(card);

    video.addEventListener('loadedmetadata', () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width > 0 && height > 0) {
        resolutionEl.textContent = `${width}x${height}`;
      } else {
        resolutionEl.textContent = 'Unknown';
      }
      const isHd = height >= 720 || width >= 1280;
      card.dataset.isHd = isHd ? '1' : '0';
      hdBadge.classList.toggle('hidden', !isHd);
      applyHdFilter();
    });

    video.addEventListener('error', () => {
      resolutionEl.textContent = 'Could not load metadata';
      card.dataset.isHd = '0';
      hdBadge.classList.add('hidden');
      applyHdFilter();
    });
  });

  applyHdFilter();
}

function updateMetaInfo(startUrl, resultsCount) {
  metaInfo.textContent = `Scanned starting from: ${startUrl} — Found ${resultsCount} video file(s).`;
}

function applyHdFilter() {
  const hdOnly = hdToggle.checked;
  const cards = videoGrid.querySelectorAll('.card');
  cards.forEach((card) => {
    if (hdOnly && card.dataset.isHd !== '1') {
      card.style.display = 'none';
    } else {
      card.style.display = '';
    }
  });
}

function setLoading(isLoading) {
  if (isLoading) {
    statusMessage.textContent = 'Scanning... This may take a moment depending on the site.';
  } else {
    statusMessage.textContent = '';
  }
  startUrlInput.disabled = isLoading;
  scanButton.disabled = isLoading;
}

function showError(message) {
  errorMessage.textContent = message || '';
}

async function handleScan(event) {
  event.preventDefault();
  showError('');
  const normalizedUrl = normalizeInputUrl(startUrlInput.value);
  if (!normalizedUrl) {
    showError('Please enter a valid http or https URL.');
    return;
  }

  setLoading(true);
  clearResults();
  hdToggleWrapper.classList.add('hidden');
  emptyState.style.display = 'none';
  updateMetaInfo(normalizedUrl, 0);

  try {
    const results = await crawl(normalizedUrl);
    renderResults(results);
    updateMetaInfo(normalizedUrl, results.length);
  } catch (err) {
    showError('An unexpected error occurred while scanning.');
  } finally {
    setLoading(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  hdToggle = document.getElementById('toggleHdOnly');
  videoGrid = document.getElementById('videoGrid');
  metaInfo = document.getElementById('metaInfo');
  metaBar = document.getElementById('metaBar');
  errorMessage = document.getElementById('errorMessage');
  statusMessage = document.getElementById('statusMessage');
  emptyState = document.getElementById('emptyState');
  startUrlInput = document.getElementById('startUrlInput');
  scanButton = document.getElementById('scanButton');
  hdToggleWrapper = document.getElementById('hdToggleWrapper');

  const form = document.getElementById('scanForm');
  form.addEventListener('submit', handleScan);
  hdToggle.addEventListener('change', applyHdFilter);
});
