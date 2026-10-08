//! Public article extraction. External markup is converted to text/Markdown, never rendered as HTML.
use crate::storage::StorageError;

// Feed fragments and article pages are HTML, not XML. A bare ampersand in a
// query string must not discard the entire href or prevent other entities
// in the same text from being decoded. Preserve unknown entities verbatim.
pub(crate) fn decode_html(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut position = 0;
    while let Some(offset) = value[position..].find('&') {
        let start = position + offset;
        result.push_str(&value[position..start]);
        let tail = &value[start..];
        if let Some(end) = tail.as_bytes().iter().take(64).position(|byte| *byte == b';') {
            if let Ok(decoded) = quick_xml::escape::unescape(&tail[..=end]) {
                result.push_str(&decoded);
                position = start + end + 1;
                continue;
            }
        }
        result.push('&');
        position = start + 1;
    }
    result.push_str(&value[position..]);
    result
}

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
        if name.eq_ignore_ascii_case(key) { return Some(decode_html(value)); }
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
struct HtmlTag<'a> { start:usize, end:usize, raw:&'a str, name:String, closing:bool }
fn tags(html:&str)->Vec<HtmlTag<'_>> {
    let lower=html.to_ascii_lowercase();let mut position=0;let mut found=Vec::new();
    while let Some(offset)=html[position..].find('<') {
        let start=position+offset;
        if html[start..].starts_with("<!--") {position=html[start+4..].find("-->").map(|n|start+4+n+3).unwrap_or(html.len());continue;}
        let Some(size)=tag_end(&html[start..]) else{break;};let end=start+size+1;
        let raw=html[start+1..end-1].trim();let closing=raw.starts_with('/');
        let name=raw.trim_start_matches('/').split(|c:char|c.is_whitespace()||c=='/').next().unwrap_or("").to_ascii_lowercase();
        position=end;
        if !closing&&matches!(name.as_str(),"script"|"style"|"noscript"|"textarea"|"template") {
            position=lower[end..].find(&format!("</{name}")).and_then(|n|tag_end(&html[end+n..]).map(|size|end+n+size+1)).unwrap_or(html.len());continue;
        }
        found.push(HtmlTag{start,end,raw,name,closing});
    }
    found
}
fn body_rank(tag:&HtmlTag<'_>)->u8 {
    if !matches!(tag.name.as_str(),"article"|"main"|"div"|"section"){return 0;}
    if attribute(tag.raw,"itemprop").is_some_and(|v|v.split_whitespace().any(|p|p.eq_ignore_ascii_case("articleBody"))){return 4;}
    let names=format!("{} {}",attribute(tag.raw,"class").unwrap_or_default(),attribute(tag.raw,"id").unwrap_or_default()).to_ascii_lowercase();
    if names.split_whitespace().any(|v|matches!(v,"article-body"|"article__body"|"article-content"|"article__content"|"articlebody-articlebody"|"entry-content"|"wp-block-post-content"|"post-content"|"post-body"|"story-body"|"story-content")){return 4;}
    if names.split_whitespace().any(|v|matches!(v,"entrypage"|"body-content"|"article-text"|"article__text"|"body-copy")){return 4;}
    if tag.name=="article"||names.split_whitespace().any(|v|v=="article"){return 3;}
    if tag.name=="main"||attribute(tag.raw,"role").as_deref()==Some("main"){return 1;}
    0
}
fn article_fragment(html:&str)->Option<&str> {
    let mut stack:Vec<(String,usize,u8)>=Vec::new();let mut best:Option<(u8,usize,usize)>=None;
    for tag in tags(html) {
        if !matches!(tag.name.as_str(),"article"|"main"|"div"|"section"){continue;}
        if tag.closing {
            if let Some(index)=stack.iter().rposition(|(name,_,_)|*name==tag.name){
                let (_,start,rank)=stack[index];
                if rank>0&&tag.start.saturating_sub(start)>=200&&best.is_none_or(|(score,from,to)|rank>score||rank==score&&tag.start-start>to-from){best=Some((rank,start,tag.start));}
                stack.truncate(index);
            }
        }else if !tag.raw.ends_with('/') {stack.push((tag.name.clone(),tag.end,body_rank(&tag)));}
    }
    best.map(|(_,start,end)|&html[start..end])
}
fn headline(value:&str)->String {value.chars().filter(|c|c.is_alphanumeric()).flat_map(char::to_lowercase).collect()}
pub fn aggregator(base:&str)->bool {url::Url::parse(base).ok().and_then(|v|v.host_str().map(str::to_owned)).is_some_and(|host|host=="techmeme.com"||host=="www.techmeme.com")}
fn matching_source(base:&str,title:&str,label:&str,href:&str)->Option<String>{
    let label=headline(label);let title=headline(title);
    if label.chars().count()<30||!title.starts_with(&label){return None;}
    public_link(base,href).filter(|url|!aggregator(url))
}
// Select only the headline of this feed item, never the first outbound link
// or a different story in the aggregator's full daily page.
pub fn feed_original(body:&str,base:&str,title:&str)->Option<String>{
    if !aggregator(base){return None;}
    let mut urls=std::collections::BTreeSet::new();
    for (start,_) in body.match_indices('['){
        let rest=&body[start+1..];let Some(split)=rest.find("](") else{continue;};
        let destination=&rest[split+2..];let Some(end)=destination.find(')') else{continue;};
        if let Some(url)=matching_source(base,title,&rest[..split],&destination[..end]){urls.insert(url);}
    }
    if urls.len()==1{urls.into_iter().next()}else{None}
}
pub fn page_original(html:&str,base:&str,title:&str)->Option<String>{
    if !aggregator(base){return None;}
    let mut current:Option<(usize,String)>=None;let mut urls=std::collections::BTreeSet::new();
    for tag in tags(html){
        if tag.name!="a"{continue;}
        if tag.closing {
            if let Some((start,href))=current.take(){
                let label=markdown(&html[start..tag.start],base,false).ok()?;
                if let Some(url)=matching_source(base,title,&label,&href){urls.insert(url);}
            }
        }else {current=attribute(tag.raw,"href").map(|href|(tag.end,href));}
    }
    if urls.len()==1{urls.into_iter().next()}else{None}
}
pub struct AcquiredBody {pub body:String,pub kind:String,pub error:Option<String>}
fn restricted_page(html:&str)->bool {
    let compact=html.replace([' ', '\n', '\r', '\t'], "").to_ascii_lowercase();
    compact.contains("\"isaccessibleforfree\":false")||compact.contains("\"isaccessibleforfree\":\"false\"")
}
pub fn fetch_body(app:&tauri::AppHandle,base:&str,title:&str,feed_body:&str,proxy:Option<&str>)->Result<AcquiredBody,StorageError>{
    fn fetch(url:&str,proxy:Option<&str>)->Result<(String,String),StorageError>{
        let response=crate::news_http::fetch_article_with_proxy(url,proxy)?;
        let html=String::from_utf8(response.body).map_err(|_|StorageError::new("news_body_encoding","公开正文不是 UTF-8，订阅内容保留。"))?;
        Ok((html,response.url))
    }
    let target=if aggregator(base){
        if let Some(url)=feed_original(feed_body,base,title){url}else{
            let (page,url)=fetch(base,proxy)?;
            page_original(&page,&url,title).ok_or_else(||StorageError::new("news_body_unavailable","聚合页未找到与当前标题对应的唯一原报道链接，保留订阅摘要。"))?
        }
    }else{base.to_owned()};
    let fetched=fetch(&target,proxy).and_then(|(html,url)|markdown(&html,&url,true).map(|body|(body,url,restricted_page(&html))));
    let (body,url,partial)=match fetched {
        Ok(result)=>result,
        Err(error) if error.code=="news_body_unavailable"||error.code=="news_browser_required"||error.message.contains("HTTP 403")=>{
            // Render only the public page in an application-owned browser profile.
            // Never extract hidden subscriber JSON or solve access challenges.
            let (html,url)=crate::news_browser::read(app,&target,proxy)?;
            (markdown(&html,&url,true)?,url,false)
        },
        Err(error)=>return Err(error),
    };
    let body=if aggregator(base){format!("原始报道：[阅读原文]({})\n\n{body}",url.replace('(',"%28").replace(')',"%29"))}else{body};
    Ok(AcquiredBody{body,kind:if partial{"partial"}else{"web"}.into(),error:partial.then(||"来源页面声明全文需要订阅；当前只保留页面返回的公开内容，未标记为完整正文。".into())})
}
pub fn markdown(html: &str, base: &str, article_only: bool) -> Result<String, StorageError> {
    if html.len() > crate::news_http::MAX_FEED_BYTES { return Err(crate::news_editorial_types::invalid_reply()); }
    let html = if article_only {
        article_fragment(html).ok_or_else(|| StorageError::new("news_body_unavailable", "公开页面没有可辨认的正文区域，保留订阅内容与原文链接。"))?
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
                "/a" => if let Some(Some(url))=links.pop(){out.push_str("](");out.push_str(&url.replace('(',"%28").replace(')',"%29"));out.push(')');},
                "img" => if let Some(src)=attribute(tag,"src").and_then(|v|public_link(base,&v)){
                    // Images inside anchors are inline link labels. Blank lines
                    // here would split [![alt](image)](target) into three blocks.
                    let linked=links.last().is_some_and(|url|url.is_some());
                    if !linked {out.push_str("\n\n");}
                    out.push_str(&format!("![{}]({})",attribute(tag,"alt").unwrap_or_default().replace(['[',']'],"").split_whitespace().collect::<Vec<_>>().join(" "),src.replace('(',"%28").replace(')',"%29")));
                    if !linked {out.push_str("\n\n");}
                },
                "tr" => out.push_str("\n| "), "td"|"th" => {}, "/td"|"/th" => out.push_str(" | "),
                _ => {}
            }
        } else {
            let end=html[position..].find('<').unwrap_or(html.len()-position)+position;
            if hidden.is_none(){let raw=&html[position..end];let decoded=decode_html(raw);
                if pre{out.push_str(&decoded);}else{let words=decoded.split_whitespace().collect::<Vec<_>>().join(" ");if !words.is_empty(){if decoded.starts_with(char::is_whitespace)&&!out.ends_with(char::is_whitespace){out.push(' ');}out.push_str(&words);if decoded.ends_with(char::is_whitespace){out.push(' ');}}}}
            position=end;
        }
    }
    let mut normalized=String::new();let mut blanks=0;for line in out.lines(){if line.trim().is_empty(){blanks+=1;if blanks>1{continue;}}else{blanks=0;}normalized.push_str(line.trim_end());normalized.push('\n');}
    let normalized=normalized.trim().to_owned();
    if article_only && normalized.chars().count()<200{return Err(StorageError::new("news_body_unavailable","公开正文不足，保留订阅内容；没有补写全文。"));}
    Ok(normalized)
}
