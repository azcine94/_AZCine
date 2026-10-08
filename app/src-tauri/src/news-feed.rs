// RSS 2.0 / RSS 1.0 / Atom. Preserve supplied full bodies before limiting summaries.
use chrono::DateTime;
use quick_xml::{Reader, events::{BytesStart, Event}};
use url::Url;
use crate::news_types::{FeedEntry, FeedKind, ParsedFeed};
use crate::storage::StorageError;

fn parse_error() -> StorageError { StorageError::new("feed_parse_failed", "订阅解析失败：需要完整的 UTF-8 RSS/Atom XML，可能是网页、登录页或信源格式变化。未替换原资料。") }
#[derive(Default)]
struct Item { title: String, id: String, link: String, link_base: String, date: String, summary: String, body: String }
struct Frame { name: String, base: String }
struct Capture { field: &'static str, depth: usize, value: String, base: String }
fn attributes(start: &BytesStart<'_>, key: &str) -> Result<Option<String>, StorageError> {
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| parse_error())?;
        if attribute.key.into_inner() == key {
            return attribute.unescape_value().map(|value| Some(value.into_owned())).map_err(|_| parse_error());
        }
    }
    Ok(None)
}
fn plain_text(value: &str) -> String {
    // Strip feed HTML before treating it as text. Nothing here is ever rendered as HTML.
    let mut result = String::new();
    let mut tag = String::new();
    let mut inside = false;
    let mut hidden: Option<String> = None;
    for c in value.chars() {
        if c == '<' && !inside { inside = true; tag.clear(); }
        else if c == '>' && inside {
            inside = false;
            let lower = tag.trim().to_ascii_lowercase();
            let name = lower.split_whitespace().next().unwrap_or("").trim_end_matches('/');
            if matches!(name, "script" | "style") { hidden = Some(name.to_owned()); }
            else if hidden.as_ref().is_some_and(|hidden| name == format!("/{hidden}")) { hidden = None; }
            if hidden.is_none() { result.push(' '); }
        } else if inside { tag.push(c); }
        else if hidden.is_none() { result.push(c); }
    }
    let decoded = crate::news_content::decode_html(&result);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn published(value: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(value).or_else(|_| DateTime::parse_from_rfc2822(value))
        .ok().map(|date| date.to_utc().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
fn finish(item: Item, feed_url: &str) -> Option<FeedEntry> {
    let title = plain_text(&item.title);
    if title.is_empty() || title.chars().count() > 2000 { return None; }
    let base = Url::parse(if item.link_base.is_empty() { feed_url } else { &item.link_base }).ok()?;
    let link = if item.link.trim().is_empty() && item.id.starts_with("http") { &item.id } else { &item.link };
    let mut url = base.join(link.trim()).ok()?;
    url.set_fragment(None);
    let url = crate::news_http::public_url(url.as_str()).ok()?;
    if link.trim().is_empty() { return None; }
    let raw = item.date.trim();
    let summary = plain_text(&item.summary);
    let summary_truncated = summary.chars().count() > 1000;
    let summary = if summary.is_empty() { None } else { Some(summary.chars().take(1000).collect()) };
    let full_text=plain_text(&item.body);
    let body_full=full_text.chars().count()>=300;
    let content=if !body_full&&plain_text(&item.summary).chars().count()>full_text.chars().count(){&item.summary}else if item.body.is_empty(){&item.summary}else{&item.body};
    let body=crate::news_content::markdown(content,url.as_str(),false).ok().filter(|v|!v.is_empty());
    Some(FeedEntry {
        external_id: if item.id.trim().is_empty() || item.id.len() > 4096 { None } else { Some(item.id.trim().to_owned()) },
        title, url: url.into(), published_at: published(raw), published_raw: if raw.is_empty() { None } else { Some(raw.chars().take(500).collect()) },
        summary, summary_truncated,
        body, body_full,
    })
}
fn apply(item: &mut Item, capture: Capture) {
    match capture.field {
        "title" => item.title = capture.value,
        "id" => item.id = capture.value,
        "link" if item.link.is_empty() => { item.link = capture.value; item.link_base = capture.base; },
        "date" if item.date.is_empty() => item.date = capture.value,
        "summary" if item.summary.is_empty() => item.summary = capture.value,
        "body" => item.body = capture.value,
        _ => {},
    }
}
fn open_element(start: &BytesStart<'_>, stack: &mut Vec<Frame>, item: &mut Option<Item>, capture: &mut Option<Capture>, kind: &mut Option<FeedKind>, item_depth: &mut usize, has_channel: &mut bool, feed_url: &str) -> Result<(), StorageError> {
    let name = start.local_name().into_inner().to_owned();
    let depth = stack.len() + 1;
    if depth > 64 { return Err(parse_error()); }
    let inherited = stack.last().map(|frame| frame.base.as_str()).unwrap_or(feed_url);
    let base = if let Some(base) = attributes(start, "xml:base")? {
        Url::parse(inherited).and_then(|parent| parent.join(&base)).map_err(|_| parse_error())?.to_string()
    } else { inherited.to_owned() };
    if depth == 1 {
        if kind.is_some() { return Err(parse_error()); }
        *kind = Some(match name.as_str() { "rss" | "RDF" => FeedKind::Rss, "feed" => FeedKind::Atom, _ => return Err(parse_error()) });
    }
    if name == "channel" && depth == 2 && *kind == Some(FeedKind::Rss) { *has_channel = true; }
    let entry_start = match *kind {
        Some(FeedKind::Atom) => name == "entry" && depth == 2,
        Some(FeedKind::Rss) => name == "item" && (depth == 3 && stack.last().is_some_and(|frame| frame.name == "channel") || depth == 2 && stack.first().is_some_and(|frame| frame.name == "RDF")),
        None => false,
    };
    if let Some(captured)=capture.as_mut(){if depth>captured.depth&&matches!(captured.field,"body"|"summary"){captured.value.push('<');captured.value.push_str(start.as_ref());captured.value.push('>');}}
    if entry_start {
        if item.is_some() { return Err(parse_error()); }
        *item = Some(Item::default()); *item_depth = depth;
    } else if let Some(item) = item.as_mut() {
        if depth == *item_depth + 1 {
            let field = match name.as_str() {
                "title" => Some("title"), "guid" | "id" => Some("id"),
                "description" | "summary" => Some("summary"),
                "encoded" if start.name().as_ref()=="content:encoded" => Some("body"),
                "content" if *kind==Some(FeedKind::Atom)&&matches!(start.name().as_ref(),"content"|"atom:content") => Some("body"),
                "pubDate" | "published" | "date" => Some("date"),
                "link" if *kind == Some(FeedKind::Rss) && attributes(start, "href")?.is_none() => Some("link"),
                _ => None,
            };
            if let Some(field) = field { *capture = Some(Capture { field, depth, value: String::new(), base: base.clone() }); }
            if name == "link" && *kind == Some(FeedKind::Atom) && item.link.is_empty() {
                let rel = attributes(start, "rel")?.unwrap_or_else(|| "alternate".into());
                let mime = attributes(start, "type")?;
                if rel == "alternate" && mime.as_deref().is_none_or(|mime| matches!(mime, "text/html" | "application/xhtml+xml")) {
                    if let Some(href) = attributes(start, "href")? { item.link = href; item.link_base = base.clone(); }
                }
            }
        }
    }
    stack.push(Frame { name, base });
    Ok(())
}
fn close_element(stack: &mut Vec<Frame>, item: &mut Option<Item>, capture: &mut Option<Capture>, item_depth: usize, entries: &mut Vec<FeedEntry>, skipped: &mut usize, feed_url: &str) -> Result<(), StorageError> {
    if capture.as_ref().is_some_and(|capture| capture.depth == stack.len()) {
        if let (Some(item), Some(captured)) = (item.as_mut(), capture.take()) { apply(item, captured); }
    } else if let Some(captured) = capture.as_mut() { if matches!(captured.field,"body"|"summary"){captured.value.push_str("</");captured.value.push_str(&stack.last().ok_or_else(parse_error)?.name);captured.value.push('>');}else{captured.value.push(' ');} }
    if item.is_some() && stack.len() == item_depth {
        if entries.len() + *skipped >= 10000 { return Err(StorageError::new("feed_entries_large", "订阅超过10000条，未截断后当作完整采集。请调整来源地址。")); }
        if let Some(entry) = finish(item.take().ok_or_else(parse_error)?, feed_url) { entries.push(entry); } else { *skipped += 1; }
    }
    stack.pop().ok_or_else(parse_error)?;
    Ok(())
}
pub fn parse(body: &[u8], feed_url: &str) -> Result<ParsedFeed, StorageError> {
    let xml = std::str::from_utf8(body).map_err(|_| parse_error())?.trim_start_matches('\u{feff}');
    let mut reader = Reader::from_str(xml);
    let mut stack = Vec::new(); let mut item = None; let mut capture: Option<Capture> = None;
    let mut kind = None; let mut item_depth = 0; let mut has_channel = false; let mut closed_root = false;
    let mut entries = Vec::new(); let mut skipped = 0;
    loop {
        match reader.read_event().map_err(|_| parse_error())? {
            Event::Start(start) | Event::Empty(start) if closed_root => { let _ = start; return Err(parse_error()); },
            Event::Start(start) => open_element(&start, &mut stack, &mut item, &mut capture, &mut kind, &mut item_depth, &mut has_channel, feed_url)?,
            Event::Empty(start) => {
                open_element(&start, &mut stack, &mut item, &mut capture, &mut kind, &mut item_depth, &mut has_channel, feed_url)?;
                close_element(&mut stack, &mut item, &mut capture, item_depth, &mut entries, &mut skipped, feed_url)?;
                if stack.is_empty() { closed_root = true; }
            },
            Event::End(_) => {
                close_element(&mut stack, &mut item, &mut capture, item_depth, &mut entries, &mut skipped, feed_url)?;
                if stack.is_empty() { closed_root = true; }
            },
            Event::Text(text) => {
                let text = text.xml10_content();
                if stack.is_empty() && !text.trim().is_empty() { return Err(parse_error()); }
                if let Some(capture) = capture.as_mut() { capture.value.push_str(&text); }
            },
            Event::CData(text) => { if stack.is_empty() { return Err(parse_error()); } if let Some(capture) = capture.as_mut() { capture.value.push_str(&text.xml10_content()); } },
            Event::GeneralRef(reference) => {
                if stack.is_empty() { return Err(parse_error()); }
                let decoded = quick_xml::escape::unescape(&format!("&{};", reference.as_ref())).map_err(|_| parse_error())?.into_owned();
                if let Some(capture) = capture.as_mut() { capture.value.push_str(&decoded); }
            },
            Event::Decl(declaration) => {
                if let Some(encoding) = declaration.encoding() {
                    let encoding = encoding.map_err(|_| parse_error())?;
                    if !encoding.eq_ignore_ascii_case("utf-8") && !encoding.eq_ignore_ascii_case("utf8") && !encoding.eq_ignore_ascii_case("us-ascii") { return Err(parse_error()); }
                }
            },
            Event::DocType(_) => return Err(StorageError::new("feed_doctype_unsupported", "订阅包含 DTD/外部实体声明，已停止解析，不请求外部文件。")),
            Event::Eof => break,
            _ => {},
        }
    }
    let kind = kind.ok_or_else(parse_error)?;
    if !stack.is_empty() || !closed_root || kind == FeedKind::Rss && !has_channel || entries.is_empty() && skipped > 0 { return Err(parse_error()); }
    let warning = if skipped > 0 { Some(format!("{skipped}条缺少有效标题或公开原文链接，未保存；其余条目可核对。")) } else { None };
    Ok(ParsedFeed { kind, entries, skipped, warning })
}
