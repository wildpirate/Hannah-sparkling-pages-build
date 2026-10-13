import { clampPage, readProgress, saveProgress } from './progress.js';
const $ = id => document.getElementById(id);
let storage;
try { storage = window.localStorage; } catch { /* Reading remains available without storage. */ }
let books = [], activeBook = null, pdf = null, loadingTask = null;
let pageNumber = 1, zoom = 1, generation = 0, renderGeneration = 0, renderTask = null, textLayer = null;
let pdfModule, busy = false, lastBookId = null;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const route = id => `#czytaj/${encodeURIComponent(id)}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const plural = (n, forms) => n === 1 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? forms[1] : forms[2];
const progress = book => readProgress(storage, book.id, book.pages);

function renderLibrary() {
  $('books').innerHTML = books.map(book => {
    const saved = progress(book), started = saved && saved.page > 1;
    return `<article class="book"><a class="cover-link" href="${route(book.id)}" aria-label="${started ? 'Czytaj dalej' : 'Czytaj'}: ${escapeHtml(book.title)}"><img src="${escapeHtml(book.cover)}" alt="Okładka książki ${escapeHtml(book.title)}" width="600" height="850" decoding="async">${started ? `<span class="ribbon" aria-hidden="true">${icon('bookmark')}</span>` : ''}</a><h3><a href="${route(book.id)}">${escapeHtml(book.title)}</a></h3><p class="book-meta">${started ? `Zakładka: strona ${saved.page} z ${book.pages}` : `${book.pages} ${plural(book.pages, ['strona', 'strony', 'stron'])} do odkrycia`}</p><a class="book-action ${started ? 'resume' : ''}" href="${route(book.id)}" aria-label="${started ? 'Czytaj dalej' : 'Czytaj książkę'}: ${escapeHtml(book.title)}"><span>${started ? 'Czytaj dalej' : 'Czytaj książkę'}</span>${icon('arrow')}</a></article>`;
  }).join('');
  const latest = books.map(book => ({ book, saved: progress(book) })).filter(item => item.saved?.page > 1).sort((a,b) => b.saved.updatedAt - a.saved.updatedAt)[0];
  $('continue').hidden = !latest;
  if (latest) {
    $('continue').href = route(latest.book.id);
    $('continue-title').textContent = latest.book.title;
    $('continue-page').textContent = `Wróć do strony ${latest.saved.page} z ${latest.book.pages}`;
  }
  $('book-count').textContent = `${books.length} ${plural(books.length, ['książka', 'książki', 'książek'])}`;
}
function controls(loading = busy) {
  $('previous').disabled = loading || !pdf || pageNumber <= 1;
  $('next').disabled = loading || !pdf || pageNumber >= pdf.numPages;
  $('page-number').disabled = loading || !pdf;
  $('zoom-out').disabled = loading || !pdf || zoom <= .75;
  $('zoom-in').disabled = loading || !pdf || zoom >= 3;
  $('fit').disabled = loading || !pdf;
  $('fit').textContent = zoom === 1 ? 'Dopasuj' : `${Math.round(zoom * 100)}%`;
  $('page-number').value = pageNumber;
  $('page-number').max = pdf?.numPages || activeBook?.pages || 1;
  $('page-total').textContent = `z ${pdf?.numPages || activeBook?.pages || '…'}`;
}
function fail() {
  busy = false;
  $('loading').hidden = true;
  $('paper').hidden = true;
  $('reader-error').hidden = false;
  $('reader-status').textContent = 'Zakładka pozostała na ostatnio otwartej stronie.';
  controls(true);
}
async function openBook(book) {
  const currentGeneration = ++generation;
  ++renderGeneration;
  renderTask?.cancel();
  textLayer?.cancel();
  const oldTask = loadingTask;
  loadingTask = null;
  pdf = null;
  oldTask?.destroy().catch(() => {});
  activeBook = book;
  lastBookId = book.id;
  pageNumber = progress(book)?.page || 1;
  zoom = 1;
  busy = true;
  $('library').hidden = true;
  $('reader').hidden = false;
  document.body.classList.add('reading');
  $('reader-title').textContent = book.title;
  document.title = `${book.title} — Książki Hani`;
  $('pdf-link').href = book.pdf;
  $('error-pdf').href = book.pdf;
  $('reader-error').hidden = true;
  $('paper').hidden = true;
  $('paper').replaceChildren();
  $('loading').hidden = false;
  $('loading-message').textContent = 'Otwieramy książkę…';
  $('reader-status').textContent = '';
  controls();
  $('reader-title').focus({ preventScroll: true });
  try {
    if (!pdfModule) pdfModule = await import('./vendor/pdf.min.mjs');
    if (currentGeneration !== generation) return;
    pdfModule.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    loadingTask = pdfModule.getDocument({ url: new URL(book.pdf, document.baseURI).href, cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/wasm/', import.meta.url).href, isEvalSupported: false, disableAutoFetch: true, disableStream: true });
    loadingTask.onProgress = ({loaded,total}) => {
      if (generation === currentGeneration && !pdf) $('loading-message').textContent = total ? `Otwieramy książkę… ${Math.min(100, Math.round(loaded / total * 100))}%` : 'Otwieramy książkę…';
    };
    const documentProxy = await loadingTask.promise;
    if (generation !== currentGeneration) return;
    pdf = documentProxy;
    pageNumber = clampPage(pageNumber, pdf.numPages);
    await renderPage(true);
  } catch (error) {
    if (generation === currentGeneration) { console.error('Nie udało się wczytać PDF:', error); fail(); }
  }
}
async function renderPage(resetScroll = false) {
  if (!pdf) return;
  const request = ++renderGeneration, documentGeneration = generation;
  const requestedPage = pageNumber, requestedZoom = zoom;
  const oldRender = renderTask;
  oldRender?.cancel();
  textLayer?.cancel();
  busy = true;
  controls();
  $('reader-error').hidden = true;
  $('loading').hidden = false;
  $('loading-message').textContent = `Otwieramy stronę ${requestedPage}…`;
  $('paper').hidden = true;
  try {
    const page = await pdf.getPage(requestedPage);
    if (request !== renderGeneration || documentGeneration !== generation) return;
    const natural = page.getViewport({ scale: 1 });
    const area = $('reading-area');
    const mobile = window.matchMedia('(max-width: 700px)').matches;
    const availableWidth = area.clientWidth - (mobile ? 20 : 48);
    const fitScale = mobile ? availableWidth / natural.width : Math.min(availableWidth / natural.width, Math.max(200, area.clientHeight - 154) / natural.height);
    const viewport = page.getViewport({ scale: fitScale * requestedZoom });
    const canvas = document.createElement('canvas');
    // Cap backing pixels to keep zooming large illustrated pages safe on phones.
    const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (viewport.width * viewport.height)));
    canvas.width = Math.floor(viewport.width * density);
    canvas.height = Math.floor(viewport.height * density);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute('aria-hidden', 'true');
    renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [density,0,0,density,0,0] });
    await renderTask.promise;
    if (request !== renderGeneration || documentGeneration !== generation) return;
    const paper = $('paper');
    paper.style.width = `${viewport.width}px`;
    paper.style.height = `${viewport.height}px`;
    paper.style.setProperty('--scale-factor', viewport.scale);
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.setAttribute('aria-label', `Strona ${requestedPage}`);
    paper.replaceChildren(canvas, layer);
    paper.hidden = false;
    $('loading').hidden = true;
    busy = false;
    controls();
    if (resetScroll) area.scrollTo({ top: 0, left: 0 });
    const saved = saveProgress(storage, activeBook.id, requestedPage);
    $('reader-status').textContent = `${requestedPage === pdf.numPages ? 'To ostatnia strona. ' : ''}${saved ? `Zakładka zapisana · strona ${requestedPage}` : 'Czytaj śmiało. Przeglądarka nie pozwala zapisać zakładki.'}`;
    textLayer = new pdfModule.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
    await textLayer.render();
  } catch (error) {
    if (request !== renderGeneration || documentGeneration !== generation || error.name === 'RenderingCancelledException' || error.name === 'AbortException') return;
    console.error('Nie udało się wyświetlić strony:', error);
    fail();
  }
}
function showLibrary() {
  ++generation;
  ++renderGeneration;
  renderTask?.cancel();
  textLayer?.cancel();
  loadingTask?.destroy().catch(() => {});
  loadingTask = null;
  pdf = null;
  activeBook = null;
  busy = false;
  $('reader').hidden = true;
  $('library').hidden = false;
  document.body.classList.remove('reading');
  document.title = 'Książki Hani — mała biblioteczka, wielkie przygody';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderLibrary();
  if (lastBookId) document.querySelector(`.book-action[href="${route(lastBookId)}"]`)?.focus({preventScroll:true});
}
function handleRoute() {
  const book = books.find(book => location.hash === route(book.id));
  if (book) openBook(book);
  else { if (location.hash.startsWith('#czytaj/')) history.replaceState(null, '', location.pathname + location.search); showLibrary(); }
}
function changePage(value) {
  if (!pdf || busy) return;
  const next = clampPage(value, pdf.numPages);
  if (next === pageNumber) { controls(); return; }
  pageNumber = next;
  renderPage(true);
}
$('previous').addEventListener('click', () => changePage(pageNumber - 1));
$('next').addEventListener('click', () => changePage(pageNumber + 1));
$('page-form').addEventListener('submit', event => { event.preventDefault(); changePage($('page-number').value); });
$('page-number').addEventListener('change', () => changePage($('page-number').value));
for (const [id, delta] of [['zoom-in', .25], ['zoom-out', -.25], ['fit', 0]]) $(id).addEventListener('click', () => {
  if (busy || !pdf) return;
  zoom = delta ? Math.max(.75, Math.min(3, zoom + delta)) : 1;
  renderPage(true);
});
$('retry').addEventListener('click', () => pdf ? renderPage(true) : openBook(activeBook));
$('fullscreen').hidden = !document.fullscreenEnabled;
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('reader').requestFullscreen(); }
  catch { $('reader-status').textContent = 'Pełny ekran jest niedostępny w tej przeglądarce.'; }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Opuść pełny ekran' : 'Pełny ekran');
});
document.addEventListener('keydown', event => {
  if (!pdf || event.altKey || event.ctrlKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); changePage(pageNumber + (event.key === 'ArrowRight' ? 1 : -1)); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (pdf) renderPage(); }, 180); });
window.addEventListener('hashchange', handleRoute);
window.addEventListener('storage', () => { if (!activeBook && books.length) renderLibrary(); });
async function init() {
  try {
    const response = await fetch('books.json');
    if (!response.ok) throw new Error(`Katalog: ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.every(book => /^[a-z0-9-]+$/.test(book.id) && typeof book.title === 'string' && typeof book.pdf === 'string' && typeof book.cover === 'string' && Number.isInteger(book.pages) && book.pages > 0) || new Set(catalog.map(book => book.id)).size !== catalog.length) throw new Error('Nieprawidłowy katalog');
    for (const book of catalog) for (const field of ['pdf', 'cover']) if (!['http:', 'https:'].includes(new URL(book[field], document.baseURI).protocol)) throw new Error('Nieprawidłowy adres pliku');
    books = catalog;
    $('catalog-status').hidden = books.length > 0;
    $('catalog-status').textContent = 'Pierwsze książki pojawią się tu wkrótce.';
    handleRoute();
  } catch (error) {
    console.error(error);
    $('catalog-status').replaceChildren(document.createTextNode('Nie udało się wczytać biblioteczki. Sprawdź połączenie. '));
    const retry = document.createElement('button');
    retry.className = 'primary catalog-retry';
    retry.textContent = 'Spróbuj ponownie';
    retry.onclick = init;
    $('catalog-status').append(retry);
  }
}
init();
