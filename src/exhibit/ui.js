import { AREAS, MODELS } from './data.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tag = (kind) => `<span class="tag tag-${kind}">${kind === 'old' ? 'Antigo' : 'Atual'}</span>`;

export function initUI({ items, onView, onAction, onAutoRotate, onInset, downloadGLB }) {
  const panel = document.getElementById('panel');
  const body = document.getElementById('panel-body');
  const nav = document.getElementById('nav');
  const hint = document.getElementById('hint');
  const sheetBtn = document.getElementById('sheet-toggle');
  const rotateBtn = document.getElementById('btn-rotate');
  const mqMobile = matchMedia('(max-width: 760px)');
  const state = { kind: 'overview', arg: null };

  // ——— Modelos de conteúdo do painel
  const overviewHTML = () => `
    <p class="kicker">Como explorar</p>
    <h2>Seis aparelhos, duas épocas</h2>
    <p class="lede">Cada área coloca lado a lado um modelo antigo, à esquerda, e um atual, à direita. Todos são objetos 3D: gire, aproxime e abra as portas para ver o interior.</p>
    <ol class="area-list">
      ${AREAS.map((a) => `
        <li><button type="button" class="area-btn" data-area="${a.id}">
          <span class="area-n">${a.n}</span>
          <span class="area-t"><b>${a.title}</b><small>${a.span}</small></span>
          <span class="arrow" aria-hidden="true">→</span>
        </button></li>`).join('')}
    </ol>
    <ul class="gestures">
      <li><b>Girar</b><span>arraste com o mouse ou um dedo</span></li>
      <li><b>Zoom</b><span>role a roda do mouse ou faça pinça</span></li>
      <li><b>Mover</b><span>botão direito ou arraste com dois dedos</span></li>
      <li><b>Selecionar</b><span>clique ou toque em um aparelho</span></li>
    </ul>`;

  const areaHTML = (a) => {
    const o = MODELS[a.old], n = MODELS[a.modern];
    return `
    <p class="kicker">Área ${a.n} · ${a.span}</p>
    <h2>${a.title}</h2>
    <p class="lede">${a.intro}</p>
    <div class="pair">
      <button type="button" class="pick" data-model="${a.old}">${tag('old')}<b>${o.chip}</b><small>${o.era}</small></button>
      <button type="button" class="pick" data-model="${a.modern}">${tag('new')}<b>${n.chip}</b><small>${n.era}</small></button>
    </div>
    <div class="compare" role="table" aria-label="Comparação entre o modelo antigo e o atual">
      <div class="cmp-head" role="row"><span role="columnheader">Antigo</span><span role="columnheader">Atual</span></div>
      ${a.rows.map(([k, x, y]) => `
        <div class="cmp-row" role="row">
          <span class="cmp-k" role="rowheader">${k}</span>
          <span class="cmp-old" role="cell">${x}</span>
          <span class="cmp-new" role="cell">${y}</span>
        </div>`).join('')}
    </div>`;
  };

  const modelHTML = (id) => {
    const m = MODELS[id];
    const a = AREAS.find((x) => x.id === m.area);
    const other = m.kind === 'old' ? a.modern : a.old;
    const actions = items[id].model.actions;
    return `
    <button type="button" class="crumb" data-area="${a.id}">← Área ${a.n}: ${a.title}</button>
    <p class="kicker">${tag(m.kind)} ${m.era}</p>
    <h2>${m.name}</h2>
    <p class="lede">${m.desc}</p>
    <div class="actions">
      ${actions.map((ac) => `<button type="button" class="act" data-action="${ac.id}" aria-pressed="${ac.toggle.on}">${ac.toggle.on ? ac.activeLabel : ac.label}</button>`).join('')}
    </div>
    <dl class="specs">
      ${m.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
    </dl>
    <ul class="highlights">${m.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    <div class="footer-actions">
      <button type="button" class="link-btn" data-model="${other}">Comparar com o ${m.kind === 'old' ? 'modelo atual' : 'modelo antigo'} →</button>
      <button type="button" class="link-btn" data-download="${id}">Baixar modelo 3D (.glb)</button>
      <p class="dl-status" role="status" aria-live="polite"></p>
    </div>`;
  };

  function render() {
    if (state.kind === 'overview') body.innerHTML = overviewHTML();
    else if (state.kind === 'area') body.innerHTML = areaHTML(AREAS.find((a) => a.id === state.arg));
    else body.innerHTML = modelHTML(state.arg);
    body.scrollTop = 0;
    for (const b of nav.querySelectorAll('button')) {
      const area = state.kind === 'overview' ? null : state.kind === 'area' ? state.arg : MODELS[state.arg].area;
      const active = (b.dataset.view === 'overview' && !area) || b.dataset.area === area;
      b.setAttribute('aria-current', active ? 'true' : 'false');
    }
  }

  function updateHash() {
    const token = state.kind === 'overview' ? '' : state.kind === 'area' ? state.arg : MODELS[state.arg].hash;
    try { history.replaceState(null, '', token ? `#${token}` : location.pathname + location.search); } catch { /* sem histórico */ }
  }

  let collapsed = false;
  function measure() {
    const visible = !collapsed || !mqMobile.matches;
    panel.dataset.collapsed = String(collapsed && mqMobile.matches);
    const r = panel.getBoundingClientRect();
    const next = mqMobile.matches
      ? { top: nav.getBoundingClientRect().bottom + 6, right: 0, bottom: visible ? r.height : 0 }
      : { top: 0, right: r.width + 32, bottom: 0 };
    onInset(next);
  }

  function go(kind, arg, opts = {}) {
    state.kind = kind;
    state.arg = arg ?? null;
    render();
    measure();
    onView(kind, arg, opts);
    updateHash();
    if (started) hint.hidden = true;
  }

  // ——— Eventos
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.area) go('area', t.dataset.area);
    else if (t.dataset.model) go('model', t.dataset.model);
    else if (t.dataset.action) {
      const id = state.arg;
      const ac = items[id].model.actions.find((x) => x.id === t.dataset.action);
      const on = onAction(id, ac);
      t.setAttribute('aria-pressed', String(on));
      t.textContent = on ? ac.activeLabel : ac.label;
      if (ac.view) onView('model', id, { angle: on ? ac.view : 'front' });
    } else if (t.dataset.download) {
      const status = body.querySelector('.dl-status');
      t.disabled = true;
      status.textContent = 'Gerando o arquivo GLB…';
      try {
        const name = await downloadGLB(t.dataset.download);
        status.textContent = name.endsWith('.zip')
          ? `${name} contém o GLB no estado atual (portas e telas como estão).`
          : `${name} gerado no estado atual (portas e telas como estão).`;
      } catch (err) {
        if (err?.code === 'declined') status.textContent = 'Download cancelado.';
        else {
          console.error(err);
          status.textContent = 'Não foi possível gerar o arquivo aqui. Os arquivos GLB também estão na pasta models do projeto.';
        }
      }
      t.disabled = false;
    }
  });

  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view === 'overview') go('overview');
    else go('area', b.dataset.area);
  });

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) go('model', chip.dataset.model);
  });

  document.getElementById('btn-reset').addEventListener('click', () => go('overview'));
  rotateBtn.addEventListener('click', () => {
    const on = rotateBtn.getAttribute('aria-pressed') !== 'true';
    rotateBtn.setAttribute('aria-pressed', String(on));
    onAutoRotate(on);
  });
  document.getElementById('btn-help').addEventListener('click', () => {
    hint.hidden = !hint.hidden;
  });
  sheetBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    sheetBtn.setAttribute('aria-expanded', String(!collapsed));
    measure();
  });
  mqMobile.addEventListener('change', measure);
  new ResizeObserver(() => measure()).observe(panel);

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.kind === 'model') go('area', MODELS[state.arg].area);
    else if (state.kind === 'area') go('overview');
  });

  let moved = false;
  let started = false;
  return {
    selectModel: (id) => go('model', id),
    onUserMove() {
      if (!moved) {
        moved = true;
        setTimeout(() => { hint.hidden = true; }, 2500);
      }
    },
    start() {
      const token = decodeURIComponent(location.hash.slice(1));
      go('overview', null, { instant: true });
      started = true;
      const area = AREAS.find((a) => a.id === token);
      const model = Object.entries(MODELS).find(([, m]) => m.hash === token);
      if (area) setTimeout(() => go('area', area.id), 300);
      else if (model) setTimeout(() => go('model', model[0]), 300);
    },
  };
}
