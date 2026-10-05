//! Public article extraction. External markup is converted to text/Markdown, never rendered as HTML.
use crate::storage::StorageError;

fn attribute(tag: &str, key: &str) -> Option<String> {
    let mut rest = tag.split_once(char::is_whitespace)?.1;
    while !rest.is_empty() {
        rest = rest.trim_start();
        let end = rest.find(|c: char| c.is_whitespace() || c == '=').unwrap_or(rest.len());
        let name = &rest[..end]; rest = rest[end..].trim_start();
        if !rest.starts_with('=') { if rest.is_empty() { break; } continue; }
        rest = rest[1..].trim_start();
        let (value, tail) = if rest.starts_with(['\'', '"']) {
            let quote = rest.chars().next()?; let end = rest[1..].find(quote)? + 1;
            (&rest[1..end], &rest[end + 1..])
        } else { let end = rest.find(char::is_whitespace).unwrap_or(rest.len()); (&rest[..end], &rest[end..]) };
        if name.eq_ignore_ascii_case(key) { return Some(quick_xml::escape::unescape(value).ok()?.into_owned()); }
        rest = tail;
    }
    None
}
fn public_link(base: &str, value: &str) -> Option<String> {
    let mut url = url::Url::parse(base).ok()?.join(value).ok()?; url.set_fragment(None);
    crate::news_http::public_url(url.as_str()).ok().map(|v|v.to_string())
}
fn tag_end(fragment: &str) -> Option<usize> {
    let mut quote = None;
    for (offset, ch) in fragment.char_indices() {
        match quote {
            Some(mark) if ch == mark => quote = None,
            Some(_) => {},
            None if ch == '\'' || ch == '"' => quote = Some(ch),
            None if ch == '>' => return Some(offset),
            None => {},
        }
    }
    None
}
pub fn markdown(html: &str, base: &str, article_only: bool) -> Result<String, StorageError> {
    if html.len() > crate::news_http::MAX_FEED_BYTES { return Err(crate::news_editorial_types::invalid_reply()); }
    let lower = html.to_ascii_lowercase();
    let html = if article_only {
        let (start, end) = ["article", "main"].iter().find_map(|name| {
            let start = lower.find(&format!("<{name}"))?;
            let opening = tag_end(&html[start..])? + start + 1;
            let end = lower[opening..].find(&format!("</{name}>"))? + opening;
            Some((opening, end))
        }).ok_or_else(|| StorageError::new("news_body_unavailable", "公开页面没有可辨认的正文区域，保留订阅内容与原文链接。"))?;
        &html[start..end]
    } else { html };
    let mut out = String::new(); let mut position = 0; let mut hidden: Option<String> = None;
    let mut links: Vec<Option<String>> = Vec::new(); let mut pre = false;
    while position < html.len() {
        if html.as_bytes()[position] == b'<' {
            let Some(end) = tag_end(&html[position..]) else { break; }; let tag = html[position+1..position+end].trim(); position += end + 1;
            let name = tag.split_whitespace().next().unwrap_or("").trim_end_matches('/').to_ascii_lowercase();
            if let Some(h) = &hidden { if name == format!("/{h}") { hidden = None; } continue; }
            if matches!(name.as_str(), "script"|"style"|"nav"|"footer"|"form"|"iframe"|"noscript"|"svg") { hidden = Some(name); continue; }
            match name.as_str() {
                "h1"|"h2"|"h3"|"h4"|"h5"|"h6" => {out.push_str("\n\n");out.push_str(&"#".repeat(name[1..].parse::<usize>().unwrap_or(2)));out.push(' ');},
                "/h1"|"/h2"|"/h3"|"/h4"|"/h5"|"/h6"|"/p"|"/div"|"/section"|"/ul"|"/ol"|"/table" => out.push_str("\n\n"),
                "br"|"/li" => out.push('\n'), "li" => out.push_str("\n- "), "blockquote" => out.push_str("\n\n> "),
                "strong"|"b"|"/strong"|"/b" => out.push_str("**"), "em"|"i"|"/em"|"/i" => out.push('*'),
                "pre" => {pre=true;out.push_str("\n\n```\n");}, "/pre" => {pre=false;out.push_str("\n```\n\n");},
                "code"|"/code" if !pre => out.push('`'),
                "a" => {let url=attribute(tag,"href").and_then(|v|public_link(base,&v));if url.is_some(){out.push('[');}links.push(url);},
                "/a" => if let Some(Some(url))=links.pop(){out.push_str("](");out.push_str(&url.replace(')',"%29"));out.push(')');},
                "img" => if let Some(src)=attribute(tag,"src").and_then(|v|public_link(base,&v)){out.push_str(&format!("\n\n![{}]({})\n\n",attribute(tag,"alt").unwrap_or_default().replace(['[',']'],""),src.replace(')',"%29")));},
                "tr" => out.push_str("\n| "), "td"|"th" => {}, "/td"|"/th" => out.push_str(" | "),
                _ => {}
            }
        } else {
            let end=html[position..].find('<').unwrap_or(html.len()-position)+position;
            if hidden.is_none(){let raw=&html[position..end];let decoded=quick_xml::escape::unescape(raw).map(|v|v.into_owned()).unwrap_or_else(|_|raw.replace("&nbsp;"," ").replace("&mdash;","—").replace("&ndash;","–").replace("&hellip;","…"));
                if pre{out.push_str(&decoded);}else{let words=decoded.split_whitespace().collect::<Vec<_>>().join(" ");if !words.is_empty(){if decoded.starts_with(char::is_whitespace)&&!out.ends_with(char::is_whitespace){out.push(' ');}out.push_str(&words);if decoded.ends_with(char::is_whitespace){out.push(' ');}}}}
            position=end;
        }
    }
    let mut normalized=String::new();let mut blanks=0;for line in out.lines(){if line.trim().is_empty(){blanks+=1;if blanks>1{continue;}}else{blanks=0;}normalized.push_str(line.trim_end());normalized.push('\n');}
    let normalized=normalized.trim().to_owned();
    if article_only && normalized.chars().count()<200{return Err(StorageError::new("news_body_unavailable","公开正文不足，保留订阅内容；没有补写全文。"));}
    Ok(normalized)
}
