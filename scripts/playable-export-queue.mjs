import { randomUUID } from 'node:crypto';

const reject = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const shortText = value => typeof value === 'string' ? value.trim().slice(0, 48) : '';

// Only the head may start a build. Waiting browsers keep their ticket alive
// with short requests instead of holding an export connection open in line.
export function createPlayableExportQueue({ now = Date.now, leaseMs = 120_000, capacity = 32 } = {}) {
  let jobs = [];
  let sequence = 0;
  function sweep() {
    jobs = jobs.filter(job => job.running || job.expires > now());
  }
  function reserve({ owner, level, platform }) {
    sweep();
    if (jobs.length >= capacity) throw reject(429, '导出队列已满，请稍后再提交。');
    const job = {
      ticket: randomUUID(), number: ++sequence, expires: now() + leaseMs,
      owner: shortText(owner), level: shortText(level), platform: shortText(platform), running: false
    };
    jobs.push(job);
    return job.ticket;
  }
  function view(ticket) {
    sweep();
    const index = jobs.findIndex(job => job.ticket === ticket);
    if (index >= 0) jobs[index].expires = now() + leaseMs;
    return {
      mine: index >= 0 ? jobs[index].number : null,
      jobs: jobs.map(({ number, owner, level, platform, running }, i) => ({
        number, owner, level, platform, state: i > 0 ? 'waiting' : running ? 'running' : 'ready'
      }))
    };
  }
  function start(ticket, metadata) {
    sweep();
    if (!ticket) {
      if (jobs.length) throw reject(409, '已有导出任务，请刷新编辑器后加入队列。');
      ticket = reserve(metadata);
    }
    const head = jobs[0];
    if (!head || head.ticket !== ticket || head.running) throw reject(409, '尚未轮到此任务，或排队凭证已失效。');
    head.running = true;
    return () => { jobs = jobs.filter(job => job !== head); };
  }
  function cancel(ticket) {
    jobs = jobs.filter(job => job.ticket !== ticket || job.running);
  }
  return { reserve, view, start, cancel };
}
