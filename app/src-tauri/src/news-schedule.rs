use chrono::{DateTime,Utc,TimeZone,FixedOffset,NaiveTime};
use crate::storage::StorageError;
fn at(time:&str,now:DateTime<Utc>)->Result<DateTime<FixedOffset>,StorageError>{
    let zone=FixedOffset::east_opt(8*3600).unwrap();let date=now.with_timezone(&zone).date_naive();
    let time=NaiveTime::parse_from_str(time,"%H:%M").map_err(|_|StorageError::new("news_config_invalid","日报时间必须为HH:MM。"))?;
    zone.from_local_datetime(&date.and_time(time)).single().ok_or_else(||StorageError::new("news_config_invalid","无法计算北京时间。"))
}
pub fn due_daily(time:&str,now:DateTime<Utc>)->Result<Option<String>,StorageError>{let today=at(time,now)?;Ok(if now>=today.with_timezone(&Utc){Some(today.format("%Y-%m-%d").to_string())}else{None})}
pub fn next_daily(time:&str,now:DateTime<Utc>)->Result<String,StorageError>{let today=at(time,now)?;let next=if now>=today.with_timezone(&Utc){today+chrono::Duration::days(1)}else{today};Ok(next.to_rfc3339_opts(chrono::SecondsFormat::Millis,true))}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn given_beijing_nine_when_check_before_after_and_timezone_then_only_due_today_and_no_early_catchup(){
        let before=DateTime::parse_from_rfc3339("2026-10-04T00:59:59Z").unwrap().with_timezone(&Utc);
        assert_eq!(due_daily("09:00",before).unwrap(),None);
        let after=DateTime::parse_from_rfc3339("2026-10-04T01:00:00Z").unwrap().with_timezone(&Utc);
        assert_eq!(due_daily("09:00",after).unwrap(),Some("2026-10-04".into()));
        assert_eq!(next_daily("09:00",after).unwrap(),"2026-10-05T09:00:00.000+08:00");
    }
}
