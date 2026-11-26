const endpoint = '/__playable-export-queue';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestQueue(method, ticket, options = {}) {
  const response = await fetch(endpoint, {
    method, cache: 'no-store', signal: AbortSignal.timeout(8000), ...options,
    headers: { ...options.headers, ...(ticket ? { 'X-Export-Ticket': ticket } : {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法获取导出队列。');
  return data;
}

export function createEditorExportQueue(panel, platforms) {
  const summary = panel.querySelector('output');
  const list = panel.querySelector('ol');
  const cancel = panel.querySelector('button');
  const names = new Map(platforms.map(([id, label]) => [id, label]));
  names.set('all', '全部 7 个渠道');
  let ticket = null;
  let waiting = false;
  let cancelled = false;
  let reading = false;
  let revision = 0;

  function render({ jobs, mine }) {
    const ahead = jobs.findIndex(job => job.number === mine);
    summary.textContent = jobs.length
      ? (ahead > 0 ? '我的前面有 ' + ahead + ' 个任务' : '等待 ' + (jobs.length - 1) + ' 个')
      : '空闲';
    list.replaceChildren(...jobs.map((job, index) => {
      const row = document.createElement('li');
      row.dataset.state = job.state;
      const state = document.createElement('span');
      state.textContent = { running: '打包中', ready: '准备中', waiting: '排队 ' + index }[job.state];
      const name = document.createElement('span');
      name.textContent = [job.number === mine ? '我的任务' : job.owner || '其他任务',
        job.level, names.get(job.platform)].filter(Boolean).join(' · ');
      row.append(state, name);
      return row;
    }));
  }
  async function refresh() {
    if (reading || waiting || document.hidden || !panel.getClientRects().length) return;
    const generation = revision;
    reading = true;
    try {
      const data = await requestQueue('GET', ticket);
      if (generation === revision) render(data);
    } catch {
      if (generation === revision) {
        summary.textContent = '队列连接中断';
        list.replaceChildren();
      }
    } finally { reading = false; }
  }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) void refresh();
  });
  observer.observe(panel);
  const poll = setInterval(refresh, 3000);
  function release() {
    revision++;
    const previous = ticket;
    ticket = null;
    waiting = false;
    cancel.hidden = true;
    if (previous) void requestQueue('DELETE', previous, { keepalive: true }).catch(() => {});
  }
  cancel.addEventListener('click', () => {
    cancelled = true;
    release();
    void refresh();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    clearInterval(poll);
    observer.disconnect();
    release();
  });

  async function enter(metadata, headers, onWait, signal) {
    signal?.throwIfAborted();
    revision++;
    waiting = true;
    cancelled = false;
    let data = await requestQueue('POST', null, {
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(metadata)
    });
    ticket = data.ticket;
    while (!cancelled && !signal?.aborted) {
      render(data);
      const index = data.jobs.findIndex(job => job.number === data.mine);
      if (index < 0) throw new Error('排队已过期，请重新提交导出。');
      if (index === 0 && data.jobs[0].state === 'ready') {
        waiting = false;
        cancel.hidden = true;
        return ticket;
      }
      onWait(index);
      cancel.hidden = false;
      await pause(2000);
      if (!cancelled && !signal?.aborted) {
        try {
          data = await requestQueue('GET', ticket);
        } catch (error) {
          if (!(error instanceof TypeError || error.name === 'TimeoutError')) throw error;
          summary.textContent = '正在重新连接队列';
          await pause(2000);
          if (!cancelled && !signal?.aborted) data = await requestQueue('GET', ticket);
        }
      }
    }
    throw new DOMException('已取消排队。', 'AbortError');
  }
  return { enter, finish() { release(); void refresh(); } };
}
