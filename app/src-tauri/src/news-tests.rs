// Synthetic acceptance cases only. Written with this delivery; not executed without user authorization.
use super::*;
use crate::{news_capture, news_feed, news_http};
use std::{fs, net::IpAddr, path::PathBuf};

fn root() -> PathBuf {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().prefix("news-storage-").tempdir_in(base).unwrap().keep().join("data")
}
fn request(n: u64) -> String { format!("aabbccdd-1111-2222-3333-{n:012x}") }
fn input(id: u64, source: &Source, enabled: bool) -> SaveSource {
    let mut config = source.config.clone(); config.enabled = enabled;
    SaveSource { request_id: request(id), expected_revision: Some(source.revision), source: config }
}
fn feed() -> ParsedFeed {
    news_feed::parse(br#"<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>fixture</title>
        <item><guid>fixture-1</guid><title>Fixture &amp; summary</title><link>https://example.org/news/1?utm_source=feed</link>
        <pubDate>Fri, 02 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Subscription <b>summary</b></p>]]></description></item>
        <item><guid>fixture-2</guid><title>No publication time</title><link>https://example.org/news/2</link></item>
        </channel></rss>"#, "https://example.org/feed.xml").unwrap()
}
#[test]
fn given_initial_sources_when_edit_pause_and_reopen_then_18_defaults_do_not_overwrite_user_config_or_history() {
    let root = root(); let mut store = Store::open(&root, true).unwrap();
    let sources = store.news_sources().unwrap(); assert_eq!(sources.len(), 18);
    let mut edit = input(1, &sources[0], false); edit.source.name = "User edited source".into();
    let saved = store.save_news_source(edit).unwrap(); assert_eq!(saved.revision, 2); drop(store);
    let reopened = Store::open(&root, false).unwrap();
    assert_eq!(reopened.news_sources().unwrap().len(), 18);
    let source = reopened.news_source(&saved.config.id).unwrap().unwrap();
    assert_eq!(source.config, saved.config); assert_eq!(source.revision, 2);
}
#[test]
fn given_public_192_addresses_when_resolve_feed_then_allow_them_and_still_reject_reserved_subnets() {
    for value in ["192.0.66.2", "192.2.1.2"] { assert!(news_http::public_ip(value.parse::<IpAddr>().unwrap()), "{value}"); }
    for value in ["192.0.0.1", "192.0.2.1", "192.168.1.1", "192.88.99.1"] { assert!(!news_http::public_ip(value.parse::<IpAddr>().unwrap()), "{value}"); }
}
#[test]
fn given_same_save_request_when_retried_after_new_revision_then_return_original_receipt_and_reject_stale_overwrite() {
    let root = root(); let mut store = Store::open(&root, true).unwrap(); let source = store.news_sources().unwrap().remove(0);
    let first = input(1, &source, false); let saved = store.save_news_source(first.clone()).unwrap();
    let next = store.save_news_source(input(2, &saved, true)).unwrap(); assert_eq!(next.revision, 3);
    assert_eq!(store.save_news_source(first).unwrap().revision, 2);
    assert_eq!(store.save_news_source(input(3, &source, true)).unwrap_err().code, "stale_record");
    assert_eq!(store.news_source(&source.config.id).unwrap().unwrap().revision, 3);
}
#[test]
fn given_duplicates_invalid_urls_and_new_source_when_save_then_reject_without_partial_config() {
    let root = root(); let mut store = Store::open(&root, true).unwrap(); let sources = store.news_sources().unwrap();
    let mut duplicate = input(1, &sources[0], true); duplicate.source.name = sources[1].config.name.clone();
    assert_eq!(store.save_news_source(duplicate).unwrap_err().code, "duplicate_source_name");
    let mut invalid = input(2, &sources[0], true); invalid.source.feed_url = "http://127.0.0.1/feed".into();
    assert_eq!(store.save_news_source(invalid).unwrap_err().code, "unsupported_feed_url");
    let mut new = input(3, &sources[0], true); new.expected_revision = None; new.source.id = request(99); new.source.name = "New fixture source".into();
    assert_eq!(store.save_news_source(new.clone()).unwrap_err().code, "new_source_paused");
    new.source.enabled = false; store.save_news_source(new).unwrap();
    assert_eq!(store.news_sources().unwrap().len(), 19);
}
#[test]
fn given_rss_atom_and_bad_input_when_parse_then_keep_dates_summaries_and_reject_non_feed_or_truncation() {
    let rss = feed(); assert_eq!(rss.kind, FeedKind::Rss); assert_eq!(rss.entries[0].title, "Fixture & summary");
    assert_eq!(rss.entries[0].summary.as_deref(), Some("Subscription summary"));
    assert!(rss.entries[0].published_at.is_some()); assert_eq!(rss.entries[1].published_at, None);
    let atom = news_feed::parse(br#"<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.org/news/"><entry><id>fixture</id><title>Atom</title><link href="one"/><updated>2026-10-02T08:00:00Z</updated><summary>Only summary</summary></entry></feed>"#, "https://example.org/atom.xml").unwrap();
    assert_eq!(atom.kind, FeedKind::Atom); assert_eq!(atom.entries[0].url, "https://example.org/news/one");
    assert!(atom.entries[0].published_at.is_none()); // updated is not a claimed publication date.
    for xml in ["<html><body>not a feed</body></html>", "<rss><channel><item>", "<!DOCTYPE rss SYSTEM 'file:///secret'><rss><channel/></rss>"] {
        assert!(news_feed::parse(xml.as_bytes(), "https://example.org/feed").is_err());
    }
    assert_eq!(news_feed::parse(b"<rss><channel/></rss>", "https://example.org/feed").unwrap().entries.len(), 0);
}
#[test]
fn given_repeat_feed_when_save_twice_then_deduplicate_and_keep_start_config_and_missing_publication() {
    let root = root(); let mut store = Store::open(&root, true).unwrap(); let source = store.news_sources().unwrap().remove(0);
    let first = store.begin_news_batch(&request(1), Some(&source.config.id)).unwrap().unwrap().remove(0);
    assert!(store.begin_news_batch(&request(1), Some(&source.config.id)).unwrap().is_none());
    let mut edit = input(2, &source, false); edit.source.name = "Changed after start".into(); store.save_news_source(edit).unwrap();
    let parsed = feed(); let discovered = "2026-10-04T01:00:00.000Z";
    store.news_cache_parsed(&first.id, &parsed, discovered).unwrap(); store.save_news_materials(&first, &parsed, discovered).unwrap();
    let page = store.news_materials(None, 0).unwrap(); assert_eq!(page.total, 2); assert_eq!(page.items[0].source_name, source.config.name);
    assert!(page.items.iter().any(|entry| entry.published_at.is_none()));
    let paused = store.news_source(&source.config.id).unwrap().unwrap(); store.save_news_source(input(3, &paused, true)).unwrap();
    let second = store.begin_news_batch(&request(4), Some(&source.config.id)).unwrap().unwrap().remove(0);
    store.news_cache_parsed(&second.id, &parsed, discovered).unwrap(); store.save_news_materials(&second, &parsed, discovered).unwrap();
    assert_eq!(store.news_materials(None, 0).unwrap().total, 2); assert_eq!(store.news_run_status(&second.id).unwrap(), RunStatus::NoNew);
}
#[test]
fn given_save_failure_and_crash_when_retry_or_reopen_then_keep_inputs_and_do_not_report_success() {
    let root = root(); let mut store = Store::open(&root, true).unwrap(); let source = store.news_sources().unwrap().remove(0);
    let work = store.begin_news_batch(&request(1), Some(&source.config.id)).unwrap().unwrap().remove(0);
    let parsed = feed(); store.news_cache_parsed(&work.id, &parsed, "2026-10-04T00:00:00.000Z").unwrap();
    store.db.execute_batch("CREATE TRIGGER reject_news BEFORE INSERT ON news_materials BEGIN SELECT RAISE(ABORT,'fixture disk error'); END;").unwrap();
    assert!(store.save_news_materials(&work, &parsed, "2026-10-04T00:00:00.000Z").is_err()); assert_eq!(store.news_materials(None, 0).unwrap().total, 0);
    assert_eq!(store.news_parsed(&work.id).unwrap().0.entries.len(), 2); drop(store);
    let mut reopened = Store::open(&root, false).unwrap(); assert_eq!(reopened.news_run_status(&work.id).unwrap(), RunStatus::Interrupted);
    assert_eq!(reopened.news_retry_stage(&work.id).unwrap(), RetryStage::Save);
    reopened.db.execute_batch("DROP TRIGGER reject_news;").unwrap();
    let (parsed, fetched_at) = reopened.news_parsed(&work.id).unwrap(); reopened.save_news_materials(&work, &parsed, &fetched_at).unwrap();
    assert_eq!(reopened.news_materials(None, 0).unwrap().total, 2);
    assert_eq!(reopened.news_retry_stage(&work.id).unwrap_err().code, "news_retry_not_failed");
}
#[test]
fn given_crash_before_parse_when_reopen_then_resume_retained_response_and_only_fetch_missing_input() {
    let root = root(); let mut store = Store::open(&root, true).unwrap();
    let work = store.begin_news_batch(&request(1), None).unwrap().unwrap();
    store.news_run_stage(&work[0].id, RunStatus::Parsing, false).unwrap();
    store.news_run_stage(&work[1].id, RunStatus::Fetching, false).unwrap();
    let response = news_http::FeedResponse { body: b"<rss><channel/></rss>".to_vec(), url: work[0].source.feed_url.clone(), fetched_at: "2026-10-04T00:00:00.000Z".into() };
    news_capture::write(&root, &work[0].id, &response).unwrap();
    drop(store);
    let mut reopened = Store::open(&root, false).unwrap();
    let snapshot = reopened.news_snapshot().unwrap();
    assert_eq!(snapshot.runs.iter().find(|run| run.id == work[0].id).unwrap().retry_stage, Some(RetryStage::Parse));
    assert_eq!(snapshot.runs.iter().find(|run| run.id == work[1].id).unwrap().retry_stage, Some(RetryStage::Fetch));
    assert_eq!(reopened.news_retry_stage(&work[0].id).unwrap(), RetryStage::Parse);
    assert_eq!(reopened.news_retry_stage(&work[1].id).unwrap(), RetryStage::Fetch);
    let retained = news_capture::read(&root, &work[0].id).unwrap();
    let parsed = news_feed::parse(&retained.body, &retained.url).unwrap();
    reopened.news_cache_parsed(&work[0].id, &parsed, &retained.fetched_at).unwrap();
    reopened.save_news_materials(&work[0], &parsed, &retained.fetched_at).unwrap();
    assert_eq!(reopened.news_run_status(&work[0].id).unwrap(), RunStatus::NoNew);
    assert_eq!(news_capture::read(&root, &work[0].id).unwrap().body, response.body);
}
#[test]
fn given_response_save_failure_without_durable_input_when_reopen_then_offer_explicit_refetch_and_keep_failure_reason() {
    let root=root();let mut store=Store::open(&root,true).unwrap();let source=store.news_sources().unwrap().remove(0);
    let work=store.begin_news_batch(&request(1),Some(&source.config.id)).unwrap().unwrap().remove(0);
    store.news_run_failure(&work.id,RunStatus::SaveFailed,"fixture response not durable").unwrap();drop(store);
    let reopened=Store::open(&root,false).unwrap();let run=reopened.news_snapshot().unwrap().runs.remove(0);
    assert_eq!(run.status,RunStatus::Interrupted);assert_eq!(run.retry_stage,Some(RetryStage::Fetch));
    assert!(run.error.unwrap().contains("未能留存"));assert_eq!(reopened.news_materials(None,0).unwrap().total,0);
}
#[test]
fn given_fetched_input_when_retained_then_exact_body_survives_without_overwriting_existing_capture() {
    let root = root(); fs::create_dir_all(&root).unwrap(); let id = hash("capture-fixture");
    let response = news_http::FeedResponse { body: b"<rss><channel/></rss>".to_vec(), url: "https://example.org/feed".into(), fetched_at: "2026-10-04T00:00:00.000Z".into() };
    news_capture::write(&root, &id, &response).unwrap(); assert!(news_capture::write(&root, &id, &response).is_err());
    assert_eq!(news_capture::read(&root, &id).unwrap().body, response.body);
}
#[test]
fn given_private_addresses_and_auth_when_validate_then_reject_before_public_request() {
    for value in ["http://localhost/feed", "http://127.0.0.1/feed", "http://192.168.1.1/feed", "http://[::1]/feed", "https://example.org:8443/feed", "https://user:pass@example.org/feed", "file:///feed.xml", "https://example.org/feed?token=fixture"] {
        assert!(news_http::public_url(value).is_err(), "{value}");
    }
    for value in ["10.0.0.1", "100.64.0.1", "169.254.1.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "2001:db8::1"] {
        assert!(!news_http::public_ip(value.parse::<IpAddr>().unwrap()), "{value}");
    }
    assert!(news_http::public_url("https://example.org/feed.xml").is_ok());
}

#[test]
fn media_content_cannot_replace_feed_article_body() {
    let prose="Public article paragraph with real reporting and source context. ".repeat(12);
    let xml=format!(r#"<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>Article</title><link>https://example.org/article</link><description>Summary</description><content:encoded><![CDATA[<p>{prose}</p>]]></content:encoded><media:content url="https://example.org/photo.jpg"><media:title>Photo credit only</media:title></media:content></item></channel></rss>"#);
    let feed=news_feed::parse(xml.as_bytes(),"https://example.org/rss").unwrap();
    assert!(feed.entries[0].body_full);
    assert!(feed.entries[0].body.as_ref().unwrap().contains("real reporting"));
    assert!(!feed.entries[0].body.as_ref().unwrap().contains("Photo credit"));
}
#[test]
fn image_caption_alone_is_not_full_feed_body() {
    let xml=r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>Article</title><link>https://example.org/article</link><description>Actual RSS summary.</description><media:content url="https://example.org/photo.jpg"><media:title>Photo credit</media:title></media:content></item></channel></rss>"#;
    let feed=news_feed::parse(xml.as_bytes(),"https://example.org/rss").unwrap();
    assert!(!feed.entries[0].body_full);
    assert_eq!(feed.entries[0].body.as_deref(),Some("Actual RSS summary."));
}
