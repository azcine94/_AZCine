//! AIHOT templates, unchanged at 9acad0c3d7687d9210c2b7774f83799dfd36734b.
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use crate::storage::StorageError;
pub const UPSTREAM: &str = "9acad0c3d7687d9210c2b7774f83799dfd36734b";
pub fn source(name: &str) -> Result<&'static str,StorageError> { Ok(match name {
    "content-understanding" => include_str!("../resources/news-prompts/content-understanding.md"),
    "group-batch" => include_str!("../resources/news-prompts/group-batch.md"),
    "group-definitions" => include_str!("../resources/news-prompts/group-definitions.md"),
    "group-method" => include_str!("../resources/news-prompts/group-method.md"),
    "group-pair" => include_str!("../resources/news-prompts/group-pair.md"),
    "group-signal" => include_str!("../resources/news-prompts/group-signal.md"),
    "identity-context" => include_str!("../resources/news-prompts/identity-context.md"),
    "prefilter" => include_str!("../resources/news-prompts/prefilter.md"),
    "report-period-no-sections" => include_str!("../resources/news-prompts/report-period-no-sections.md"),
    "report-period-sections" => include_str!("../resources/news-prompts/report-period-sections.md"),
    "report-period" => include_str!("../resources/news-prompts/report-period.md"),
    "rules-answer-first-summary" => include_str!("../resources/news-prompts/rules-answer-first-summary.md"),
    "rules-anti-hallucination" => include_str!("../resources/news-prompts/rules-anti-hallucination.md"),
    "rules-domain" => include_str!("../resources/news-prompts/rules-domain.md"),
    "rules-self-contained-title" => include_str!("../resources/news-prompts/rules-self-contained-title.md"),
    "safety" => include_str!("../resources/news-prompts/safety.md"),
    "selection-score" => include_str!("../resources/news-prompts/selection-score.md"),
    "story-digest" => include_str!("../resources/news-prompts/story-digest.md"),
    "structure" => include_str!("../resources/news-prompts/structure.md"),
    "summarize-article-empty" => include_str!("../resources/news-prompts/summarize-article-empty.md"),
    "summarize-article" => include_str!("../resources/news-prompts/summarize-article.md"),
    "summarize-long-post-quoted" => include_str!("../resources/news-prompts/summarize-long-post-quoted.md"),
    "summarize-long-post" => include_str!("../resources/news-prompts/summarize-long-post.md"),
    "summarize-short-post-quoted" => include_str!("../resources/news-prompts/summarize-short-post-quoted.md"),
    "summarize-short-post" => include_str!("../resources/news-prompts/summarize-short-post.md"),
    "translate-body" => include_str!("../resources/news-prompts/translate-body.md"),
    "translate-post" => include_str!("../resources/news-prompts/translate-post.md"),
    "understand" => include_str!("../resources/news-prompts/understand.md"),
    _ => return Err(crate::news_editorial_types::invalid_reply()),
}) }
pub fn taxonomy()->Value {serde_json::from_str(include_str!("../resources/news-prompts/taxonomy.json")).expect("bundled AIHOT taxonomy")}
pub fn variables()->Value {
    let t=taxonomy();let categories=t["categories"].as_array().expect("categories");
    json!({"siteName":"AZCine","categoryCount":categories.len(),
        "categoryGuide":categories.iter().map(|c|format!("- {}（{}）：{}",c["key"].as_str().unwrap_or_default(),c["label"].as_str().unwrap_or_default(),c["guide"].as_str().unwrap_or_default())).collect::<Vec<_>>().join("\n"),
        "categoryTags":t["categoryTags"],"topicTags":t["topicTags"],"entityTags":t["entityTags"],"entities":t["entities"]})
}
fn expand(name:&str,vars:&Value,depth:usize,hasher:&mut Sha256)->Result<String,StorageError>{
    if depth>12{return Err(crate::news_editorial_types::invalid_reply());}let raw=source(name)?;hasher.update(name);hasher.update(raw);
    let mut result=String::new();let mut remaining=raw;
    while let Some(start)=remaining.find("{{") {result.push_str(&remaining[..start]);let tail=&remaining[start+2..];let end=tail.find("}}").ok_or_else(crate::news_editorial_types::invalid_reply)?;let token=tail[..end].trim();
        if let Some(part)=token.strip_prefix('>'){result.push_str(&expand(part.trim(),vars,depth+1,hasher)?);}else{let value=vars.get(token).ok_or_else(crate::news_editorial_types::invalid_reply)?;if let Some(text)=value.as_str(){result.push_str(text);}else{result.push_str(&value.to_string());}}
        remaining=&tail[end+2..];
    }result.push_str(remaining);Ok(result)
}
pub fn render(name:&str,vars:&Value)->Result<(String,String),StorageError>{let mut h=Sha256::new();h.update(UPSTREAM);h.update(include_str!("../resources/news-prompts/taxonomy.json"));let text=expand(name,vars,0,&mut h)?;Ok((text,format!("{:x}",h.finalize())))}
pub fn hash(text:&str)->String{format!("{:x}",Sha256::digest(text.as_bytes()))}
