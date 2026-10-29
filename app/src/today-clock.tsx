import { useEffect, useState } from 'react';
import { Card } from './components/ui/card.tsx';

const pad = (value: number) => String(value).padStart(2, '0');
const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function TodayClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      if (!document.hidden) timer = setTimeout(sync, 1000 - current.getMilliseconds());
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  const date = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const dayProgress = ((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 864).toFixed(1);
  return <Card variant="review" className="today-clock p-6 gap-3" role="region" aria-label="今天的日期和时间">
    <header className="today-clock-heading"><h2>今天</h2><span>{weekdays[now.getDay()]}</span></header>
    <time dateTime={now.toISOString()} aria-label={`${date}，${weekdays[now.getDay()]}，${clock}`}>
      <span className="today-clock-digits" aria-hidden="true">{pad(now.getHours())}<span className="today-clock-colon">:</span>{pad(now.getMinutes())}<span className="today-clock-seconds">:{pad(now.getSeconds())}</span></span>
      <span className="today-clock-date" aria-hidden="true">{date}</span>
    </time>
    <div className="today-clock-progress" role="img" aria-label={`今日已过 ${dayProgress}%`}>
      <span className="today-clock-progress-label" aria-hidden="true">今日</span>
      <span className="today-clock-progress-bar" aria-hidden="true"><span style={{ width: `${dayProgress}%` }} /></span>
      <span className="today-clock-progress-value" aria-hidden="true">{dayProgress}%</span>
    </div>
  </Card>;
}
