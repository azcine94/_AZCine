import { NativeSelect } from './components/ui/native-select.tsx';
import { Input } from './components/ui/input.tsx';
import { DateInput } from './date-input.tsx';
import type { NewsRange } from './news-scope.ts';
export function NewsRangeControl({value,onChange,collection=false,disabled=false}:{value:NewsRange;onChange(value:NewsRange):void;collection?:boolean;disabled?:boolean}){
  return <div className="news-range-control">
    <label>{collection?'采集范围':'资料范围'}<NativeSelect variant="app" className="select" value={value.period} disabled={disabled} onChange={e=>onChange({...value,period:e.target.value as NewsRange['period']})}>
      {!collection&&<option value="latest">本次采集新增</option>}<option value="day">最近24小时</option><option value="week">最近7天</option><option value="custom">自定义日期</option><option value="all">全部时间</option>
    </NativeSelect></label>
    {value.period==='custom'&&<div className="news-range-dates"><label>开始日期<DateInput label="范围开始日期" value={value.start??''} onChange={start=>onChange({...value,start})} disabled={disabled}/></label><label>结束日期<DateInput label="范围结束日期" value={value.end??''} onChange={end=>onChange({...value,end})} disabled={disabled}/></label></div>}
    {value.period!=='latest'&&<label className="news-range-undated"><Input variant="inline" type="checkbox" checked={value.includeUndated} disabled={disabled} onChange={e=>onChange({...value,includeUndated:e.target.checked})}/>纳入日期不明的资料</label>}
    <p className="meta">{value.period==='latest'?'只包含最近一轮采集新入库的资料；重复抓到的旧资料不计入。旧版采集资料可改选时间范围查看。':'按原发布时间筛选，日期不明单独处理；自定义日期按北京时间。'}{collection?' RSS仅提供它当前返回的内容，范围控制保存入库，不保证能补抓历史。':''}</p>
  </div>;
}
