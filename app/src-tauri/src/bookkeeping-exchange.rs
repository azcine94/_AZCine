use crate::storage::StorageError;
use serde::{Deserialize, Serialize};

pub const SOURCE: &str = "frankfurter-ecb";
pub fn currency(value: &str) -> bool { matches!(value,"USD"|"EUR"|"HKD"|"JPY"|"GBP"|"AUD"|"CAD"|"SGD") }
pub fn date(value: &str) -> bool {
    value.len()==10 && !value.starts_with("0000") && chrono::NaiveDate::parse_from_str(value,"%Y-%m-%d").is_ok_and(|d|d.format("%Y-%m-%d").to_string()==value)
}
fn invalid() -> StorageError { StorageError::new("exchange_invalid", "汇率或原币金额无效，输入保留，请重新获取汇率。") }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Rate { pub currency:String, pub rate:String, pub requested_date:String, pub rate_date:String, pub source:String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Exchange { pub original_minor:i64, pub quote:Rate }
pub fn decimal(value:&str) -> Result<(i128,i128),StorageError> {
    let mut parts=value.split('.');
    let whole=parts.next().unwrap_or(""); let fractional=parts.next(); let fraction=fractional.unwrap_or("");
    if parts.next().is_some()||whole.is_empty()||whole.len()>6||fractional==Some("")||fraction.len()>12||!whole.bytes().all(|b|b.is_ascii_digit())||!fraction.bytes().all(|b|b.is_ascii_digit()) {return Err(invalid());}
    let digits=format!("{whole}{fraction}").parse::<i128>().map_err(|_|invalid())?;
    if digits<=0{return Err(invalid());} Ok((digits,10i128.pow(fraction.len() as u32)))
}
pub fn validate_rate(quote:&Rate)->Result<(),StorageError>{
    if !currency(&quote.currency)||!date(&quote.requested_date)||!date(&quote.rate_date)||quote.rate_date>quote.requested_date||quote.source!=SOURCE{return Err(invalid());}
    decimal(&quote.rate)?;Ok(())
}
pub fn converted(exchange:&Exchange)->Result<i64,StorageError>{
    validate_rate(&exchange.quote)?;
    if !(1..=crate::bookkeeping::MAX_AMOUNT).contains(&exchange.original_minor){return Err(invalid());}
    let (rate,scale)=decimal(&exchange.quote.rate)?;
    let amount=(exchange.original_minor as i128*rate+scale/2)/scale;
    if !(1..=crate::bookkeeping::MAX_AMOUNT as i128).contains(&amount){return Err(StorageError::new("exchange_amount_range","折算金额需在 0.01 至 99,999,999.99 元之间。"));}
    Ok(amount as i64)
}
pub fn fetch(currency_value:String,requested_date:String)->Result<Rate,StorageError>{
    let today=(chrono::Utc::now()+chrono::Duration::hours(14)).format("%Y-%m-%d").to_string();
    if !currency(&currency_value)||!date(&requested_date)||requested_date>today{return Err(StorageError::new("exchange_request","请选择支持的币种与非未来的有效开销日期。"));}
    let url=format!("https://api.frankfurter.dev/v2/providers/ecb/rate/{currency_value}/CNY?date={requested_date}");
    let response=crate::news_http::fetch_exchange(&url).map_err(|e| {
        let reason=e.message.replace("订阅","汇率").replace("信源","汇率服务")
            .replace("未报告采集成功。", "").replace("未报告采集成功；", "")
            .replace("未当作正常无新增；", "");
        StorageError::new("exchange_network",&format!("汇率读取失败，输入保留，可稍后重试。{reason}"))
    })?;
    let endpoint=url::Url::parse(&response.url).map_err(|_|invalid())?;
    if endpoint.scheme()!="https"||endpoint.host_str()!=Some("api.frankfurter.dev")||response.body.len()>4096{return Err(invalid());}
    #[derive(Deserialize)] struct Reply {date:String,base:String,quote:String,rate:serde_json::Number}
    let reply:Reply=serde_json::from_slice(&response.body).map_err(|_|invalid())?;
    if reply.base!=currency_value||reply.quote!="CNY"{return Err(invalid());}
    let quote=Rate{currency:currency_value,requested_date,rate_date:reply.date,rate:reply.rate.to_string(),source:SOURCE.to_owned()};
    validate_rate(&quote)?;Ok(quote)
}
